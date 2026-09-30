#!/usr/bin/env bash
# Включает рассылку уведомлений (Telegram, push, web push) и автопубликацию в облачном Supabase:
# создаёт секреты, по которым база вызывает функции notify-dispatch и auto-publish,
# и кладёт их в Supabase Vault и в секреты функций. То же делает шаг 4 ./scripts/setup.sh,
# но без вопросов и без остальных шагов. Можно запускать повторно (секреты заменятся новыми).
# Запуск из корня проекта:  ./scripts/enable-notifications.sh
set -euo pipefail

cd "$(dirname "$0")/.."
SUPABASE="${SUPABASE_CLI:-npx --yes supabase@2}"

REF=$(cat supabase/.temp/project-ref 2>/dev/null || true)
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] || { echo "Проект не привязан: сначала npx supabase@2 link --project-ref <ref>" >&2; exit 1; }
PROJECT_URL="https://$REF.supabase.co"

NOTIFY_WEBHOOK_SECRET=$(openssl rand -hex 24)
AUTOPUBLISH_SECRET=$(openssl rand -hex 24)

echo "== Секреты функций ($PROJECT_URL)"
$SUPABASE secrets set "NOTIFY_WEBHOOK_SECRET=$NOTIFY_WEBHOOK_SECRET" "AUTOPUBLISH_SECRET=$AUTOPUBLISH_SECRET" >/dev/null

echo "== Секреты базы (Vault)"
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

echo "Готово: новые уведомления будут отправляться сразу."
