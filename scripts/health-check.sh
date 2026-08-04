#!/usr/bin/env bash
# 一键健康检查：后端服务、Solana RPC、关键接口。
# 用法：bash scripts/health-check.sh
# Env: BACKEND_URL / TRADE_URL / POOL_URL / INDEXER_URL / FRONTEND_URL / SOLANA_RPC_URL
set -uo pipefail

BACKEND="${BACKEND_URL:-http://localhost:3001}"
TRADE="${TRADE_URL:-http://localhost:3004}"
POOL="${POOL_URL:-http://localhost:3005}"
INDEXER="${INDEXER_URL:-http://localhost:3003}"
FRONTEND="${FRONTEND_URL:-http://localhost:3100}"
RPC="${SOLANA_RPC_URL:-http://localhost:8899}"

checks=()
failed=0

check_json() {
  local name="$1" url="$2"
  local body
  if body="$(curl -sf --max-time 5 "$url" 2>/dev/null)"; then
    checks+=("$(jq -cn --arg name "$name" --arg status "PASS" --arg detail "$body" '{name:$name,status:$status,detail:$detail}')")
  else
    checks+=("$(jq -cn --arg name "$name" --arg status "FAIL" --arg detail "$url unreachable" '{name:$name,status:$status,detail:$detail}')")
    failed=$((failed + 1))
  fi
}

check_http() {
  local name="$1" url="$2"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo 000)"
  if [[ "$code" =~ ^(200|204|302)$ ]]; then
    checks+=("$(jq -cn --arg name "$name" --arg status "PASS" --arg detail "HTTP $code" '{name:$name,status:$status,detail:$detail}')")
  else
    checks+=("$(jq -cn --arg name "$name" --arg status "FAIL" --arg detail "HTTP $code" '{name:$name,status:$status,detail:$detail}')")
    failed=$((failed + 1))
  fi
}

check_json "backend /health" "${BACKEND}/health"
check_json "trade /health" "${TRADE}/health"
check_json "pool /health" "${POOL}/health"
check_json "indexer /health" "${INDEXER}/health"

if curl -s --max-time 5 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC" | grep -q '"result":"ok"'; then
  checks+=("$(jq -cn --arg name "solana rpc" --arg status "PASS" --arg detail "healthy" '{name:$name,status:$status,detail:$detail}')")
else
  checks+=("$(jq -cn --arg name "solana rpc" --arg status "FAIL" --arg detail "unhealthy" '{name:$name,status:$status,detail:$detail}')")
  failed=$((failed + 1))
fi

check_json "pool overview" "${POOL}/api/pool/overview"
check_json "indexer status" "${INDEXER}/api/indexer/status"
check_http "frontend" "${FRONTEND}/login"

ok="true"
if [[ "${failed}" -gt 0 ]]; then ok="false"; fi

checks_json="$(printf '%s\n' "${checks[@]}" | jq -s .)"
jq -n --argjson ok "$ok" --argjson checks "$checks_json" \
  '{ok:$ok, checkedAt:(now|todate), checks:$checks}' \
  > /tmp/health-check-report.json

echo "report: /tmp/health-check-report.json"
printf '%-8s %s\n' "STATUS" "CHECK"
printf '%s\n' "${checks[@]}" | jq -r '"\(.status)     \(.name)"'

if [[ "${failed}" -gt 0 ]]; then
  echo "health check failed: ${failed} item(s)" >&2
  exit 1
fi
echo "health check passed"
