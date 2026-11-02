#!/usr/bin/env bash
# Replaces your local pako_dev database with the demo data set (backend/seed/pako_demo.sql.gz).
#
#   scripts/demo/load_demo_db.sh          # asks before dropping pako_dev
#   scripts/demo/load_demo_db.sh --yes
#
# A fresh `docker compose -f backend/docker-compose.yml up -d` (empty volume) loads it by itself;
# this is for an existing volume. Stop the API first; it migrates the database on its next start.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DUMP="$REPO/backend/seed/pako_demo.sql.gz"
CONTAINER="${PAKO_PG_CONTAINER:-pako-postgres-1}"
if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "This DROPS the database pako_dev in $CONTAINER and loads the demo data. Continue? [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]] || exit 1
fi
docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'pako_dev' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS pako_dev;" -c "CREATE DATABASE pako_dev;"
gunzip -c "$DUMP" | docker exec -i "$CONTAINER" psql -U postgres -d pako_dev -v ON_ERROR_STOP=1 -q >/dev/null
echo "Loaded. Start the API (it applies any newer migrations) and see docs/DEMO_ACCOUNTS.md for the logins."
