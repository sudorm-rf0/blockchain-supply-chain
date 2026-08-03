#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# 扩展 HTTP 压测：覆盖读/写全路径
# 用法:
#   LOGIN_EMAIL=admin@supply-chain.io LOGIN_PASSWORD=Admin123! \
#   DURATION=10 CONCURRENCY=50 bash scripts/load-test/run-load-test.sh full
# ============================================================

DURATION="${DURATION:-10}"
CONCURRENCY="${CONCURRENCY:-50}"
BACKEND="${BACKEND_URL:-http://localhost:3001}"
TRADE="${TRADE_API_URL:-http://localhost:3004}"
POOL="${POOL_API_URL:-http://localhost:3005}"
INDEXER="${INDEXER_API_URL:-http://localhost:3003}"
TOKEN=""

run() {
  local name="$1"
  shift
  echo "=== ${name} ==="
  autocannon -c "${CONCURRENCY}" -d "${DURATION}" -j "$@" \
    | jq '{
      requests, non2xx, errors,
      latency: {avg: .latency.average, p99: .latency.p99},
      throughput: {avg: .throughput.average},
      statusCodeStats
    }'
  echo ""
}

# ---- 获取 token ----
if [[ -n "${LOGIN_EMAIL:-}" && -n "${LOGIN_PASSWORD:-}" ]]; then
  TOKEN=$(curl -sS -X POST "${BACKEND}/api/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${LOGIN_EMAIL}\",\"password\":\"${LOGIN_PASSWORD}\"}" | jq -r '.accessToken // .token // empty')
  if [[ -n "${TOKEN}" && "${TOKEN}" != "null" ]]; then
    echo "token acquired: ${#TOKEN} chars"
  else
    echo "WARNING: token acquisition failed, authenticated tests will be skipped"
    TOKEN=""
  fi
fi

AUTH=()
if [[ -n "${TOKEN}" ]]; then
  AUTH=(-H "authorization: Bearer ${TOKEN}")
fi

# ============ 读接口 ============
echo "--- 读接口 (C=${CONCURRENCY}, D=${DURATION}s) ---"
run "health (backend)"         "${BACKEND}/health"
run "health (trade)"           "${TRADE}/health"
run "health (pool)"            "${POOL}/health"
run "indexer status"           "${INDEXER}/api/indexer/status"
run "pool overview (cached)"   "${POOL}/api/pool/overview"

if [[ -n "${TOKEN}" ]]; then
  run "files list (auth)"      "${AUTH[@]}" "${BACKEND}/api/files?limit=10"
  run "trades list (auth)"     "${AUTH[@]}" "${TRADE}/api/trades"
  run "me (auth)"              "${AUTH[@]}" "${BACKEND}/api/auth/me"
fi

# ============ 写接口（低并发，涉及 DB/RPC） ============
echo "--- 写接口 (C=5, D=${DURATION}s) ---"
WRITE_CONC=5

if [[ -n "${TOKEN}" ]]; then
  run "trade create (RPC)"     "${AUTH[@]}" -m POST \
    -H 'content-type: application/json' \
    -b "{\"buyerWallet\":\"9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin\",\"sellerWallet\":\"8xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin\",\"amount\":\"1000000\",\"tenor\":\"30\"}" \
    "${TRADE}/api/trades" \
    -c "${WRITE_CONC}"

  run "pool overview (no-cache)" "${AUTH[@]}" \
    -H 'cache-control: no-cache' \
    "${POOL}/api/pool/overview" \
    -c "${WRITE_CONC}"
fi

echo "=== 压测完成 ==="
