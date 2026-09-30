#!/usr/bin/env bash
# Просмотровая версия приложения на http://localhost:8081 — без Docker и без облака.
# Демо-данные, вход: client@demo.am / manager@demo.am / designer@demo.am / freelancer@demo.am, пароль demo1234.
# Сохраняются только сообщения в чатах и личный кабинет (пока сервер работает). Для полноценной версии — ./scripts/local.sh.
#
#   ./scripts/preview.sh               собрать и запустить (Ctrl+C — остановить)
#   ./scripts/preview.sh --background  запустить в фоне (работает, пока не перезагрузите компьютер)
#   ./scripts/preview.sh --stop        остановить фоновый сервер
set -euo pipefail

cd "$(dirname "$0")/.."
PORT=8081
OUT=apps/mobile/dist-preview
LOG=apps/mobile/preview.log

stop() { fuser -k "$PORT/tcp" >/dev/null 2>&1 || true; }

if [ "${1:-}" = "--stop" ]; then
  stop
  echo "Остановлено."
  exit 0
fi

echo "== Сборка веб-приложения для просмотра"
(
  cd apps/mobile
  [ -d node_modules ] || npm install
  EXPO_PUBLIC_SUPABASE_URL="http://localhost:$PORT" \
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=demo \
  EXPO_PUBLIC_TELEGRAM_BOT=aroma_demo_bot \
    npx expo export --platform web --clear --output-dir dist-preview >/dev/null
)

stop
if [ "${1:-}" = "--background" ]; then
  setsid nohup python3 scripts/preview/mock_server.py "$OUT" "$PORT" >"$LOG" 2>&1 < /dev/null &
  sleep 1
  echo "Просмотр запущен в фоне: http://localhost:$PORT  (остановить: $0 --stop)"
else
  exec python3 scripts/preview/mock_server.py "$OUT" "$PORT"
fi
