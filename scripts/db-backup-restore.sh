#!/usr/bin/env bash
# Postgres backup / restore drill with a JSON verification report.
#
# Usage:
#   bash scripts/db-backup-restore.sh drill          # one-click backup + restore + verify (default)
#   bash scripts/db-backup-restore.sh backup         # only take a backup
#   bash scripts/db-backup-restore.sh restore <file> # restore a dump into a temp DB and verify
#
# Env:
#   CONTAINER   postgres container name (default supply-chain-postgres)
#   POSTGRES_USER (default postgres)
#   DB          source database (default supply_chain)
#   TEST_DB     temp database for the drill (default supply_chain_drill_<timestamp>)
#   DUMP_PATH   backup file (default /tmp/supply_chain_backup.dump)
#   REPORT_PATH report file (default /tmp/backup-drill-report.json)
#   KEEP_TEMP=1 keep the temp database after verification
set -euo pipefail

CONTAINER="${CONTAINER:-supply-chain-postgres}"
# 可通过 CONTAINER 指定独立容器，便于 CI 并行运行不冲突
POSTGRES_USER="${POSTGRES_USER:-postgres}"
DB="${DB:-supply_chain}"
TEST_DB="${TEST_DB:-supply_chain_drill_$(date +%Y%m%d_%H%M%S)}"
DUMP_PATH="${DUMP_PATH:-/tmp/supply_chain_backup.dump}"
REPORT_PATH="${REPORT_PATH:-/tmp/backup-drill-report.json}"
KEEP_TEMP="${KEEP_TEMP:-0}"

TABLES=("User" "TradeDeal" "PoolSnapshot" "WithdrawRequest" "File" "AuditLog" "RefreshToken")

table_sql() {
  case "$1" in
    WithdrawRequest) echo "withdraw_requests" ;;
    File) echo "files" ;;
    AuditLog) echo "audit_logs" ;;
    RefreshToken) echo "refresh_tokens" ;;
    *) echo "$1" ;;
  esac
}

psql() {
  docker exec "${CONTAINER}" psql -U "${POSTGRES_USER}" "$@"
}

pg_dump_cmd() {
  docker exec "${CONTAINER}" pg_dump -U "${POSTGRES_USER}" "$@"
}

pg_restore_cmd() {
  docker exec "${CONTAINER}" pg_restore -U "${POSTGRES_USER}" "$@"
}

cleanup() {
  if [[ "${KEEP_TEMP}" != "1" && -n "${TEST_DB}" ]]; then
    psql -c "DROP DATABASE IF EXISTS \"${TEST_DB}\";" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

count_rows() {
  local db="$1"
  local table="$2"
  local sql_table
  sql_table="$(table_sql "${table}")"
  psql -d "${db}" -t -A -c "select count(*) from \"${sql_table}\";" | tr -d '[:space:]'
}

collect_counts() {
  local db="$1"
  local out=""
  for table in "${TABLES[@]}"; do
    local count
    count="$(count_rows "${db}" "${table}")"
    out="${out}${table}:${count}
"
  done
  printf '%s' "${out}"
}

verify_restore() {
  local dump_file="$1"
  local restored_db="$2"
  local failures=0
  local notes=()

  if ! docker exec "${CONTAINER}" pg_restore -U "${POSTGRES_USER}" --list "${dump_file}" >/dev/null 2>&1; then
    printf 'note: dump file is not a valid pg_restore archive\n'
    failures=1
  fi

  local source_counts restored_counts
  source_counts="$(collect_counts "${DB}")"
  restored_counts="$(collect_counts "${restored_db}")"

  local table count_a count_b
  while IFS=: read -r table count_a; do
    count_b="$(printf '%s\n' "${restored_counts}" | sed -n "s/^${table}://p")"
    if [[ -z "${count_b}" ]]; then
      printf 'note: %s: missing in restored database\n' "${table}"
      failures=1
      continue
    fi
    if [[ "${count_a}" != "${count_b}" ]]; then
      printf 'note: %s: source=%s restored=%s (MISMATCH)\n' "${table}" "${count_a}" "${count_b}"
      failures=1
    else
      printf 'note: %s: %s ok\n' "${table}" "${count_a}"
    fi
  done <<< "${source_counts}"

  printf 'failures=%s\n' "${failures}"
}

start_ts="$(date +%s)"
command_name="${1:-drill}"

if [[ "${command_name}" == "backup" ]]; then
  pg_dump_cmd -Fc -d "${DB}" -f "${DUMP_PATH}"
  dump_bytes="$(docker exec "${CONTAINER}" sh -c "wc -c < ${DUMP_PATH}" | tr -d '[:space:]')"
  duration="$(( $(date +%s) - start_ts ))"
  echo "backup written: ${DUMP_PATH} (${dump_bytes} bytes)"
  jq -n \
    --arg command "backup" \
    --argjson ok true \
    --argjson duration "${duration}" \
    --arg dumpPath "${DUMP_PATH}" \
    --argjson bytes "${dump_bytes}" \
    '{ok: $ok, command: $command, durationSeconds: $duration, dumpPath: $dumpPath, bytes: $bytes}' \
    > "${REPORT_PATH}"
  echo "report: ${REPORT_PATH}"
  exit 0
fi

if [[ "${command_name}" == "restore" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "usage: $0 restore <dumpfile>" >&2
    exit 2
  fi
  DUMP_PATH="$2"
  if [[ ! -f "${DUMP_PATH}" ]]; then
    echo "dump file not found: ${DUMP_PATH}" >&2
    exit 2
  fi
fi

echo "==> [1/4] taking backup: ${DB} -> ${DUMP_PATH}"
pg_dump_cmd -Fc -d "${DB}" -f "${DUMP_PATH}"
dump_bytes="$(docker exec "${CONTAINER}" sh -c "wc -c < ${DUMP_PATH}" | tr -d '[:space:]')"
echo "    backup bytes: ${dump_bytes}"

echo "==> [2/4] creating temp database: ${TEST_DB}"
psql -c "DROP DATABASE IF EXISTS \"${TEST_DB}\";" >/dev/null
psql -c "CREATE DATABASE \"${TEST_DB}\";" >/dev/null

echo "==> [3/4] restoring backup into temp database"
if ! pg_restore_cmd -d "${TEST_DB}" "${DUMP_PATH}" >/dev/null 2>&1; then
  echo "restore failed" >&2
  jq -n \
    --arg command "drill" \
    --argjson ok false \
    --arg dumpPath "${DUMP_PATH}" \
    '{ok: $ok, command: $command, dumpPath: $dumpPath, checks: [], notes: ["restore failed"]}' \
    > "${REPORT_PATH}"
  exit 1
fi

echo "==> [4/4] verifying restored rows"
verify_output="$(verify_restore "${DUMP_PATH}" "${TEST_DB}")"
verify_failures="$(printf '%s\n' "${verify_output}" | sed -n 's/^failures=//p')"
verify_notes=()
while IFS= read -r line; do
  verify_notes+=("${line}")
done < <(printf '%s\n' "${verify_output}" | sed -n 's/^note: //p')

duration="$(( $(date +%s) - start_ts ))"
ok="false"
if [[ "${verify_failures}" == "0" ]]; then
  ok="true"
fi

checks_json="$(
  for line in "${verify_notes[@]}"; do
    table="${line%%:*}"
    rest="${line#*:}"
    if [[ "${line}" == *MISMATCH* || "${line}" == *missing* || "${line}" == *invalid* || "${line}" == *restore* ]]; then
      status="FAIL"
    else
      status="PASS"
    fi
    jq -cn --arg table "${table}" --arg status "${status}" --arg detail "${rest}" \
      '{table: $table, status: $status, detail: $detail}'
  done | jq -s .
)"

jq -n \
  --arg command "${command_name}" \
  --argjson ok "${ok}" \
  --argjson duration "${duration}" \
  --arg dumpPath "${DUMP_PATH}" \
  --argjson bytes "${dump_bytes}" \
  --arg sourceDb "${DB}" \
  --arg restoredDb "${TEST_DB}" \
  --argjson checks "${checks_json}" \
  '{ok: $ok, command: $command, durationSeconds: $duration, dumpPath: $dumpPath, bytes: $bytes, sourceDb: $sourceDb, restoredDb: $restoredDb, checks: $checks}' \
  > "${REPORT_PATH}"

echo "----------------------------------------"
echo "backup restore drill report: ${REPORT_PATH}"
cat "${REPORT_PATH}"
echo "----------------------------------------"

if [[ "${ok}" == "true" ]]; then
  echo "backup-restore drill passed"
else
  echo "backup-restore drill FAILED" >&2
  exit 1
fi
