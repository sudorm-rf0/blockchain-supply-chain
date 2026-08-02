#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT/.dev-logs}"
mkdir -p "${LOG_DIR}"

declare -A SERVICES=(
  ["backend"]="3001|packages/backend|pnpm dev"
  ["indexer"]="3003|packages/backend|REDIS_URL=redis://localhost:6380 pnpm dev:indexer"
  ["trade"]="3004|packages/backend|pnpm dev:trade"
  ["pool"]="3005|packages/backend|REDIS_URL=redis://localhost:6380 pnpm dev:pool"
  ["frontend"]="3100|packages/frontend|FRONTEND_PORT=3100 pnpm dev"
)

PIDS=()
cleanup() {
  echo ""
  echo "stopping dev services..."
  for pid in "${PIDS[@]}"; do
    kill_tree "${pid}" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

kill_tree() {
  local pid="$1"
  local children
  children="$(pgrep -P "${pid}" 2>/dev/null || true)"
  for child in ${children}; do
    kill_tree "${child}"
  done
  kill "${pid}" 2>/dev/null || true
}

is_port_free() {
  ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

for name in "${!SERVICES[@]}"; do
  entry="${SERVICES[$name]}"
  port="${entry%%|*}"
  rest="${entry#*|}"
  dir="${rest%%|*}"
  command="${rest#*|}"
  if ! is_port_free "${port}"; then
    echo "[${name}] already running on ${port}, skipping"
    continue
  fi
  log="${LOG_DIR}/${name}.log"
  echo "[${name}] starting on ${port} -> ${log}"
  (cd "${ROOT}/${dir}" || exit 1; eval "${command}") >"${log}" 2>&1 &
  PIDS+=("$!")
done

echo ""
echo "all services requested. logs: ${LOG_DIR}"
echo "frontend: http://localhost:3100"
wait
