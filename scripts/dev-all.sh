#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT/.dev-logs}"
mkdir -p "${LOG_DIR}"

# 本地代币/合约配置：运行 init-localnet 后保存为 infra/config/localnet.env
#   node scripts/init-localnet.mjs | tee infra/config/localnet.env
LOCALNET_ENV="${LOCALNET_ENV:-$ROOT/infra/config/localnet.env}"
ENV_PREFIX=""
if [[ -f "${LOCALNET_ENV}" ]]; then
  set -a
  source "${LOCALNET_ENV}"
  set +a
  ENV_PREFIX="USDC_MINT=${USDC_MINT:-} LP_MINT=${LP_MINT:-}"
else
  echo "warning: ${LOCALNET_ENV} not found; trade/pool will use dev placeholder mints" >&2
fi

SERVICES=(
  "backend|3001|packages/backend|pnpm dev"
  "scan-stub|3311|.|PORT=3311 node scripts/dev-scan-stub.mjs"
  "indexer|3003|packages/backend|REDIS_URL=redis://localhost:6380 pnpm dev:indexer"
  "trade|3004|packages/backend|${ENV_PREFIX} pnpm dev:trade"
  "pool|3005|packages/backend|REDIS_URL=redis://localhost:6380 ${ENV_PREFIX} pnpm dev:pool"
  "frontend|3100|packages/frontend|FRONTEND_PORT=3100 pnpm dev"
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

for entry in "${SERVICES[@]}"; do
  name="${entry%%|*}"
  rest="${entry#*|}"
  port="${rest%%|*}"
  rest="${rest#*|}"
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
