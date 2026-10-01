#!/usr/bin/env bash
# Разворачивает проект в облачном Supabase: база, секреты, функции, настройки приложения.
# Запуск из корня проекта:  ./scripts/setup.sh
# Можно запускать повторно (например, чтобы добавить ключи, пропущенные в первый раз).
set -euo pipefail

cd "$(dirname "$0")/.."
SUPABASE="${SUPABASE_CLI:-npx --yes supabase@2}"

say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
ask() { local prompt=$1 var; read -r -p "$prompt" var; printf '%s' "$var"; }
ask_secret() { local prompt=$1 var; read -r -s -p "$prompt" var; echo >&2; printf '%s' "$var"; }
random_secret() { openssl rand -hex 24; }

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -lt 18 ]; then
  echo "Нужен Node 18+ (сейчас: $(node -v 2>/dev/null || echo нет)). Откройте новый терминал, чтобы подхватился nvm." >&2
  exit 1
fi

say "1/7 Вход в Supabase"
if ! $SUPABASE projects list >/dev/null 2>&1; then
  $SUPABASE login
fi

say "2/7 Проект"
echo "Project ref — часть адреса проекта: https://<ref>.supabase.co (Project Settings → General)."
REF=$(ask "Project ref: ")
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] || { echo "Похоже, это не ref проекта: $REF" >&2; exit 1; }
PROJECT_URL="https://$REF.supabase.co"
$SUPABASE link --project-ref "$REF"

say "3/7 База данных (миграции)"
$SUPABASE db push

say "4/7 Ключи сервисов (Enter — пропустить, можно добавить позже)"
ANTHROPIC_API_KEY=$(ask_secret "Anthropic API key (для AI, console.anthropic.com): ")
IMAGE_API_KEY=$(ask_secret "OpenAI API key (картинки AI-дизайнера, platform.openai.com): ")
TELEGRAM_BOT_TOKEN=$(ask_secret "Telegram bot token (от @BotFather): ")
INSTAGRAM_APP_ID=$(ask "Instagram App ID (developers.facebook.com): ")
INSTAGRAM_APP_SECRET=""
[ -n "$INSTAGRAM_APP_ID" ] && INSTAGRAM_APP_SECRET=$(ask_secret "Instagram App Secret: ")
echo "Адрес сайта — куда возвращать после оплаты и подключения Instagram."
echo "Для GitHub Pages: https://<логин>.github.io (без подпапки)."
SITE_URL=$(ask "Адрес сайта: ")

NOTIFY_WEBHOOK_SECRET=$(random_secret)
AUTOPUBLISH_SECRET=$(random_secret)
TELEGRAM_WEBHOOK_SECRET=$(random_secret)

secrets=(
  "PAYMENT_MODE=test"
  "NOTIFY_WEBHOOK_SECRET=$NOTIFY_WEBHOOK_SECRET"
  "AUTOPUBLISH_SECRET=$AUTOPUBLISH_SECRET"
  "TELEGRAM_WEBHOOK_SECRET=$TELEGRAM_WEBHOOK_SECRET"
)
[ -n "$ANTHROPIC_API_KEY" ] && secrets+=("ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY")
[ -n "$IMAGE_API_KEY" ] && secrets+=("IMAGE_API_KEY=$IMAGE_API_KEY")
[ -n "$TELEGRAM_BOT_TOKEN" ] && secrets+=("TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN")
[ -n "$SITE_URL" ] && secrets+=("APP_RETURN_PREFIXES=marketing://,exp://,http://localhost,${SITE_URL%/}")
[ -n "$INSTAGRAM_APP_ID" ] && secrets+=("INSTAGRAM_APP_ID=$INSTAGRAM_APP_ID" "INSTAGRAM_APP_SECRET=$INSTAGRAM_APP_SECRET")
$SUPABASE secrets set "${secrets[@]}"

# Те же секреты нужны базе, чтобы она могла вызывать функции (уведомления, автопубликация).
vault_sql=$(mktemp)
trap 'rm -f "$vault_sql"' EXIT
cat > "$vault_sql" <<SQL
do \$\$
declare r record;
begin
  for r in select * from (values
    ('project_url', '$PROJECT_URL'),
    ('notify_webhook_secret', '$NOTIFY_WEBHOOK_SECRET'),
    ('autopublish_secret', '$AUTOPUBLISH_SECRET')
  ) as v(name, value) loop
    if exists (select 1 from vault.secrets where name = r.name) then
      perform vault.update_secret((select id from vault.secrets where name = r.name), r.value);
    else
      perform vault.create_secret(r.value, r.name);
    end if;
  end loop;
end
\$\$;
SQL
$SUPABASE db query --linked --file "$vault_sql" >/dev/null
echo "Секреты сохранены."

say "5/7 Серверные функции"
$SUPABASE functions deploy

say "6/7 Telegram-бот"
TELEGRAM_BOT_USERNAME=""
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  TELEGRAM_BOT_USERNAME=$(curl -fsS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.username))')
  curl -fsS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
    --data-urlencode "url=$PROJECT_URL/functions/v1/telegram-webhook" \
    --data-urlencode "secret_token=$TELEGRAM_WEBHOOK_SECRET" >/dev/null
  echo "Бот @$TELEGRAM_BOT_USERNAME подключён."
else
  echo "Пропущено."
fi

say "7/7 Настройки приложения"
PUBLISHABLE_KEY=$($SUPABASE projects api-keys --project-ref "$REF" -o json 2>/dev/null | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    try {
      const keys = JSON.parse(s);
      const list = Array.isArray(keys) ? keys : keys.keys ?? [];
      const key = list.find(k => String(k.api_key ?? "").startsWith("sb_publishable_"))
        ?? list.find(k => k.name === "anon");
      console.log(key?.api_key ?? "");
    } catch { console.log(""); }
  });' || true)
if [ -z "$PUBLISHABLE_KEY" ]; then
  echo "Не удалось получить ключ автоматически. Project Settings → API Keys → Publishable key."
  PUBLISHABLE_KEY=$(ask "Publishable key: ")
fi
# Ключ web push (см. README, «Web push») сохраняем, если он уже был.
WEB_PUSH_LINE=$(grep '^EXPO_PUBLIC_WEB_PUSH_KEY=' apps/mobile/.env.local 2>/dev/null || true)
cat > apps/mobile/.env.local <<ENV
EXPO_PUBLIC_SUPABASE_URL=$PROJECT_URL
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY
EXPO_PUBLIC_TELEGRAM_BOT=$TELEGRAM_BOT_USERNAME
ENV
[ -n "$WEB_PUSH_LINE" ] && echo "$WEB_PUSH_LINE" >> apps/mobile/.env.local
echo "Записано в apps/mobile/.env.local"

say "Готово"
cat <<TXT
Дальше:
  1. cd apps/mobile && npm install && npm start      (w — открыть в браузере)
  2. Зарегистрируйтесь в приложении, затем сделайте себя владельцем (он назначает роли):
       ./scripts/make-admin.sh ваш@email
  3. Для удобства тестов: Authentication → Sign In / Providers → Email → выключить «Confirm email».
TXT
if [ -n "$INSTAGRAM_APP_ID" ]; then
  echo "  4. В приложении Meta укажите Redirect URL: $PROJECT_URL/functions/v1/instagram-callback"
fi
