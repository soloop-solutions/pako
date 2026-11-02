#!/usr/bin/env bash
# Builds the demo database from scratch and dumps it to backend/seed/pako_demo.sql.gz.
#
#   scripts/demo/build_demo_db.sh
#
# Uses a throwaway Postgres container (pako-demo-build-pg on :5435, 512 MB shm) and an API on :5399
# pointed at it, runs scripts/demo/build.py through the API, dumps the database and removes the
# container. Your own pako_dev database is never touched. Needs docker, dotnet and python3.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PG=pako-demo-build-pg
PORT=5435
API_PORT=5399
DB=pako_dev
OUT="$REPO/backend/seed/pako_demo.sql.gz"
LOG="$(mktemp -t pako-demo-api.XXXXXX)"
export DOTNET_ROLL_FORWARD=Major

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  docker rm -f "$PG" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Fresh Postgres on :$PORT"
docker rm -f "$PG" >/dev/null 2>&1 || true
docker run -d --name "$PG" --shm-size=512m -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=$DB -p $PORT:5432 postgres:16-alpine \
  -c max_connections=200 >/dev/null
until docker exec "$PG" pg_isready -U postgres -d $DB >/dev/null 2>&1; do sleep 1; done
sleep 2

echo "==> API on :$API_PORT (migrates the empty database, creates the platform administrator)"
dotnet build "$REPO/backend/Pako.Api/Pako.Api.csproj" -v q >/dev/null
# The build signs in hundreds of times: lift the per-minute limit on the account endpoints for this run.
ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS="http://127.0.0.1:$API_PORT" Platform__AuthRequestsPerMinute=100000 \
  ConnectionStrings__Default="Host=localhost;Port=$PORT;Database=$DB;Username=postgres;Password=postgres" \
  dotnet run --no-build --project "$REPO/backend/Pako.Api/Pako.Api.csproj" --no-launch-profile >"$LOG" 2>&1 &
API_PID=$!
for _ in $(seq 1 120); do curl -sf -o /dev/null "http://127.0.0.1:$API_PORT/openapi/v1.json" && break; sleep 1; done
curl -sf -o /dev/null "http://127.0.0.1:$API_PORT/openapi/v1.json" || { tail -40 "$LOG"; exit 1; }

echo "==> Demo data"
PAKO_API="http://127.0.0.1:$API_PORT" python3 "$REPO/scripts/demo/build.py"

echo "==> Dump to $OUT"
kill "$API_PID"; API_PID=""
docker exec "$PG" pg_dump -U postgres -d $DB --no-owner --no-privileges | gzip -9 > "$OUT"
ls -lh "$OUT"
echo "Done. Accounts: docs/DEMO_ACCOUNTS.md"
