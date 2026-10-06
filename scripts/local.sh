#!/usr/bin/env bash
# Запускает всё на этом компьютере: Supabase в Docker + веб-приложение на http://localhost:8081.
# Данные хранятся локально, в Docker; наружу ничего не уходит.
#
#   ./scripts/local.sh          запустить (первый раз загрузит демо-данные)
#   ./scripts/local.sh reset    стереть локальную базу и заново загрузить демо-данные
#   ./scripts/local.sh stop     остановить Supabase
set -euo pipefail

cd "$(dirname "$0")/.."
SUPABASE="${SUPABASE_CLI:-npx --yes supabase@2}"
WEB_PORT=8081

if ! docker info >/dev/null 2>&1; then
  echo "Docker недоступен. Установите его и дайте себе права (один раз, нужен пароль):" >&2
  echo "  sudo apt install -y docker.io && sudo usermod -aG docker \$USER" >&2
  echo "Затем выйдите из системы и войдите снова (или перезагрузите компьютер)." >&2
  exit 1
fi

case "${1:-start}" in
  stop)
    $SUPABASE stop
    exit 0
    ;;
  reset)
    $SUPABASE db reset
    ;;
  start) ;;
  *)
    echo "Использование: $0 [start|reset|stop]" >&2
    exit 1
    ;;
esac

# Секреты функций для локального запуска (совпадают с supabase/seed.sql).
if [ ! -f supabase/functions/.env ]; then
  cat > supabase/functions/.env <<ENV
PAYMENT_MODE=test
NOTIFY_WEBHOOK_SECRET=local-notify-secret
AUTOPUBLISH_SECRET=local-cron-secret
TELEGRAM_WEBHOOK_SECRET=local-telegram-secret
APP_RETURN_PREFIXES=http://localhost,marketing://,exp://
ENV
  echo "Создан supabase/functions/.env. Для AI добавьте туда строку ANTHROPIC_API_KEY=sk-ant-..."
fi

echo "== Supabase (первый запуск скачивает образы Docker — это несколько минут)"
$SUPABASE start

eval "$($SUPABASE status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|PUBLISHABLE_KEY|STUDIO_URL|INBUCKET_URL|MAILPIT_URL)=')"
KEY="${PUBLISHABLE_KEY:-${ANON_KEY:-}}"
if [ -z "${API_URL:-}" ] || [ -z "$KEY" ]; then
  echo "Не удалось прочитать адрес и ключ из 'supabase status'." >&2
  exit 1
fi

echo "== Сборка веб-приложения"
cd apps/mobile
[ -d node_modules ] || npm install
EXPO_PUBLIC_SUPABASE_URL="$API_URL" \
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$KEY" \
EXPO_PUBLIC_TELEGRAM_BOT="" \
  npx expo export --platform web --clear --output-dir dist-local >/dev/null
cd ../..

cat <<TXT

== Готово
  Приложение:        http://localhost:$WEB_PORT
  База (Studio):     ${STUDIO_URL:-http://127.0.0.1:54323}
  Письма (тестовые): ${MAILPIT_URL:-${INBUCKET_URL:-http://127.0.0.1:54324}}

  Демо-аккаунты, пароль у всех demo1234:
    admin@demo.am       владелец (назначает роли)
    client@demo.am      клиент (кофейня Cafe Aroma)
    manager@demo.am     менеджер
    designer@demo.am    дизайнер
    freelancer@demo.am  фрилансер
    employee@demo.am    сотрудник (фотограф): только свои задачи
    newbie@demo.am      новый сотрудник, ждёт роли

  Оплата — тестовая. AI заработает после добавления ANTHROPIC_API_KEY в supabase/functions/.env
  и перезапуска: ./scripts/local.sh stop && ./scripts/local.sh

TXT
python3 scripts/serve-web.py apps/mobile/dist-local "$WEB_PORT"
