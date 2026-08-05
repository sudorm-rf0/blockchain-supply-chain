#!/usr/bin/env bash
# 部署后一键验证：服务健康/就绪、指标、关键接口，可选全链路冒烟。
# 用法：bash scripts/verify-deployment.sh
# Env:
#   BACKEND_URL / TRADE_URL / POOL_URL / INDEXER_URL / FRONTEND_URL
#   REQUIRE_CSP_METRIC=1  额外检查 backend /metrics 暴露 csp_violations_total
#   RUN_SMOKE=1           调用 scripts/smoke-e2e.mjs（配置 USDC_MINT/LP_MINT 时覆盖贸易全流程）
#   REPORT_PATH=/tmp/deployment-verify-report.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
TRADE_URL="${TRADE_URL:-http://localhost:3004}"
POOL_URL="${POOL_URL:-http://localhost:3005}"
INDEXER_URL="${INDEXER_URL:-http://localhost:3003}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3100}"
REQUIRE_CSP_METRIC="${REQUIRE_CSP_METRIC:-0}"
RUN_SMOKE="${RUN_SMOKE:-0}"
REPORT_PATH="${REPORT_PATH:-/tmp/deployment-verify-report.json}"

checks=()

add_check() {
  local name="$1" status="$2" detail="$3"
  checks+=("$(jq -cn --arg name "${name}" --arg status "${status}" --arg detail "${detail}" \
    '{name: $name, status: $status, detail: $detail}')")
}

http_code() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null || echo 000
}

check_http() {
  local name="$1" url="$2" expected="$3"
  local code
  code="$(http_code "${url}")"
  if [[ "${code}" == "${expected}" ]]; then
    add_check "${name}" "PASS" "HTTP ${code}"
  else
    add_check "${name}" "FAIL" "HTTP ${code}, expected ${expected}"
  fi
}

start_ts="$(date +%s)"

echo "=== deployment verification $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# --------------- Health / readiness ---------------
echo "--- Health ---"
check_http "backend /health" "${BACKEND_URL}/health" "200"
check_http "backend /health/ready" "${BACKEND_URL}/health/ready" "200"
check_http "trade /health" "${TRADE_URL}/health" "200"
check_http "pool /health" "${POOL_URL}/health" "200"
check_http "indexer /health" "${INDEXER_URL}/health" "200"
check_http "frontend /login" "${FRONTEND_URL}/login" "200"

# --------------- Metrics ---------------
echo "--- Metrics ---"
METRICS="$(curl -sf --max-time 10 "${BACKEND_URL}/metrics" 2>/dev/null || true)"
if printf '%s' "${METRICS}" | rg -q '^# HELP http_requests_total ' && \
   printf '%s' "${METRICS}" | rg -q '^# HELP process_start_time_seconds '; then
  add_check "backend /metrics" "PASS" "exposes http/process metrics"
else
  add_check "backend /metrics" "FAIL" "missing http_requests_total or process_start_time_seconds"
fi
if [[ "${REQUIRE_CSP_METRIC}" == "1" ]]; then
  if printf '%s' "${METRICS}" | rg -q '^# HELP csp_violations_total '; then
    add_check "backend csp metric" "PASS" "csp_violations_total exposed"
  else
    add_check "backend csp metric" "FAIL" "csp_violations_total missing"
  fi
fi

# --------------- Key APIs ---------------
echo "--- APIs ---"
code="$(http_code -X POST "${BACKEND_URL}/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"verify-nobody@example.com","password":"wrong-password"}')"
if [[ "${code}" == "401" ]]; then
  add_check "auth login rejects bad creds" "PASS" "HTTP ${code}"
else
  add_check "auth login rejects bad creds" "FAIL" "HTTP ${code}, expected 401"
fi
check_http "backend swagger" "${BACKEND_URL}/api-docs" "200"
code="$(http_code "${POOL_URL}/api/pool/overview")"
if [[ "${code}" == "401" ]]; then
  add_check "pool overview requires auth" "PASS" "HTTP ${code}"
else
  add_check "pool overview requires auth" "FAIL" "HTTP ${code}, expected 401"
fi
check_http "indexer status" "${INDEXER_URL}/api/indexer/status" "200"

# --------------- Optional full smoke ---------------
if [[ "${RUN_SMOKE}" == "1" ]]; then
  echo "--- Full smoke ---"
  if SOLANA_RPC_URL="${SOLANA_RPC_URL:-}" \
    BACKEND_URL="${BACKEND_URL}" \
    TRADE_URL="${TRADE_URL}" \
    POOL_URL="${POOL_URL}" \
    INDEXER_URL="${INDEXER_URL}" \
    SOLANA_KEYPAIR_PATH="${SOLANA_KEYPAIR_PATH:-}" \
    USDC_MINT="${USDC_MINT:-}" \
    node "${ROOT}/scripts/smoke-e2e.mjs" >/tmp/deployment-smoke.log 2>&1; then
    add_check "full smoke" "PASS" "see /tmp/deployment-smoke.log"
  else
    add_check "full smoke" "FAIL" "see /tmp/deployment-smoke.log"
  fi
fi

duration="$(( $(date +%s) - start_ts ))"
failures="$(printf '%s\n' "${checks[@]}" | jq -r 'select(.status == "FAIL") | .name' | wc -l | tr -d '[:space:]')"
ok="true"
if [[ "${failures}" -gt 0 ]]; then ok="false"; fi

checks_json="$(printf '%s\n' "${checks[@]}" | jq -s .)"
jq -n \
  --argjson ok "${ok}" \
  --argjson duration "${duration}" \
  --argjson checks "${checks_json}" \
  '{ok: $ok, durationSeconds: $duration, checks: $checks}' \
  > "${REPORT_PATH}"

echo "----------------------------------------"
echo "deployment verification report: ${REPORT_PATH}"
cat "${REPORT_PATH}"
echo "----------------------------------------"

if [[ "${ok}" == "true" ]]; then
  echo "deployment verification passed"
else
  echo "deployment verification FAILED" >&2
  exit 1
fi
