#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [ ! -f .env ]; then
  echo "No .env in $DIR. Create it first."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running. Open Docker Desktop, wait for it to settle, then rerun."
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -qx loml-db; then
  echo "Database already up."
elif docker ps -a --format '{{.Names}}' | grep -qx loml-db; then
  echo "Starting database..."
  docker start loml-db >/dev/null
else
  echo "Creating database..."
  docker run -d --name loml-db \
    -e POSTGRES_USER=loml -e POSTGRES_PASSWORD=loml -e POSTGRES_DB=loml \
    -p 5433:5432 postgres:16 >/dev/null
fi

printf "Waiting for Postgres"
for _ in $(seq 1 45); do
  if docker exec loml-db pg_isready -U loml -q >/dev/null 2>&1; then
    echo " ready."
    break
  fi
  printf "."
  sleep 1
done

[ -d node_modules ] || npm install

open_tab() {
  osascript >/dev/null <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "cd '$DIR' && $1"
end tell
APPLESCRIPT
}

open_tab "node --env-file=.env server/index.js"
open_tab "npm run dev:client"

sleep 4
open http://localhost:5173
echo "Two windows opened. Ctrl-C in each to stop. Database keeps running (docker stop loml-db)."
