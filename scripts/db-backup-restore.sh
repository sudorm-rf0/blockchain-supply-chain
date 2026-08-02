#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${CONTAINER:-supply-chain-postgres}"
DB="${DB:-supply_chain}"
TEST_DB="${TEST_DB:-supply_chain_restore_test}"
DUMP_PATH="${DUMP_PATH:-/tmp/supply_chain_backup.dump}"

docker exec "${CONTAINER}" pg_dump -U postgres -Fc -d "${DB}" -f "${DUMP_PATH}"
echo "backup written: ${DUMP_PATH} ($(docker exec "${CONTAINER}" sh -c "wc -c < ${DUMP_PATH}") bytes)"

docker exec "${CONTAINER}" psql -U postgres -c "DROP DATABASE IF EXISTS ${TEST_DB};" >/dev/null
docker exec "${CONTAINER}" psql -U postgres -c "CREATE DATABASE ${TEST_DB};" >/dev/null
docker exec "${CONTAINER}" pg_restore -U postgres -d "${TEST_DB}" "${DUMP_PATH}" >/dev/null 2>&1

echo "restore verification:"
docker exec "${CONTAINER}" psql -U postgres -d "${TEST_DB}" -t -A -c \
  "select (select count(*) from \"User\"), (select count(*) from \"TradeDeal\"), (select count(*) from files), (select count(*) from audit_logs);"

docker exec "${CONTAINER}" psql -U postgres -c "DROP DATABASE IF EXISTS ${TEST_DB};" >/dev/null
echo "backup-restore drill passed"
