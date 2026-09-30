#!/usr/bin/env bash
# Делает пользователя владельцем компании (admin). Владелец один: он назначает роли
# всем остальным на экране «Команда». Запуск:  ./scripts/make-admin.sh you@example.com
set -euo pipefail
cd "$(dirname "$0")/.."

EMAIL=${1:-}
if [[ ! "$EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "Использование: $0 email@example.com" >&2
  exit 1
fi

npx --yes supabase@2 db query --linked "
  update public.profiles set role = 'admin'
  where id = (select id from auth.users where lower(email) = lower('$EMAIL'))
    and not exists (select 1 from public.profiles where role = 'admin')
  returning full_name, email, role;"
echo "Если строка не вернулась: такого пользователя нет или владелец уже назначен."
