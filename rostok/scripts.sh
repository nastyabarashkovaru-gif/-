#!/usr/bin/env bash
# Локальный демо-сервер: сборка и запуск (используется для E2E)
set -e
cd "$(dirname "$0")"
npm --workspace web run build >/dev/null
npm --workspace server run build >/dev/null
pkill -f "server/dist/[i]ndex.js" || true
APP_ENV=demo PORT=${PORT:-8080} DATABASE_URL=${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/rostok} WEB_DIST=$PWD/web/dist \
  ADMIN_LOGIN=${ADMIN_LOGIN:-owner} ADMIN_PASSWORD=${ADMIN_PASSWORD:-demo-owner-pass} nohup node server/dist/index.js > ${LOG:-/tmp/rostok-server.log} 2>&1 &
sleep 2
curl -sf localhost:${PORT:-8080}/api/health
