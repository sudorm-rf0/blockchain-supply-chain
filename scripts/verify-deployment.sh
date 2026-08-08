#!/usr/bin/env bash
# 部署后一键验证：服务健康/就绪、指标、关键接口、链上字节码一致性，可选全链路冒烟。
# 用法：bash scripts/verify-deployment.sh
# Env:
#   BACKEND_URL / TRADE_URL / POOL_URL / INDEXER_URL / FRONTEND_URL
#   REQUIRE_CSP_METRIC=1  额外检查 backend /metrics 暴露 csp_violations_total
#   RUN_SMOKE=1           调用 scripts/smoke-e2e.mjs（配置 USDC_MINT/LP_MINT 时覆盖贸易全流程）
#   REPORT_PATH=/tmp/deployment-verify-report.json
#   SOLANA_RPC_URL + TRADE_FINANCE_PROGRAM_ID / SUPPLY_CHAIN_PROGRAM_ID
#                         启用链上字节码一致性检查（solana program dump sha256 比对本地构建产物）
#                         注意：本地 .so 必须是生产构建（无 test-build feature）
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
SOLANA_RPC_URL="${SOLANA_RPC_URL:-}"
TRADE_FINANCE_PROGRAM_ID="${TRADE_FINANCE_PROGRAM_ID:-}"
SUPPLY_CHAIN_PROGRAM_ID="${SUPPLY_CHAIN_PROGRAM_ID:-}"

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

# --------------- On-chain bytecode consistency（审计 supply-chain-audit 2026-08-08） ---------------
# 拉取链上程序字节码（solana program dump）与本地生产构建 .so 做 SHA-256 比对，
# 落实「链上字节码 vs 审计源码」一致性核验（审计 §6 强制项 5 / 建议项 10）。
if [[ -n "${SOLANA_RPC_URL}" ]]; then
  echo "--- On-chain bytecode consistency ---"
  verify_onchain() {
    local name="$1" pid="$2" so="$3"
    if [[ -z "${pid}" ]]; then
      add_check "${name} on-chain bytecode" "WARN" "${name}_PROGRAM_ID 未设置，跳过"
      return
    fi
    if [[ ! -f "${so}" ]]; then
      add_check "${name} on-chain bytecode" "FAIL" "本地构建产物缺失：${so}"
      return
    fi
    local local_hash onchain_hash dump_so
    dump_so="/tmp/${name}-program-dump.so"
    local_hash="$(shasum -a 256 "${so}" | awk '{print $1}')"
    if solana program dump "${pid}" "${dump_so}" --url "${SOLANA_RPC_URL}" >/dev/null 2>&1; then
      onchain_hash="$(shasum -a 256 "${dump_so}" | awk '{print $1}')"
      if [[ "${local_hash}" == "${onchain_hash}" ]]; then
        add_check "${name} on-chain bytecode" "PASS" "sha256 一致 ${local_hash:0:16}…"
      else
        add_check "${name} on-chain bytecode" "FAIL" "本地 ${local_hash:0:16}… != 链上 ${onchain_hash:0:16}…"
      fi
    else
      add_check "${name} on-chain bytecode" "FAIL" "solana program dump 失败（程序未部署或 RPC 不可达）"
    fi
  }
  verify_onchain "trade" "${TRADE_FINANCE_PROGRAM_ID}" "${ROOT}/packages/contracts/target/deploy/trade_finance.so"
  verify_onchain "supply" "${SUPPLY_CHAIN_PROGRAM_ID}" "${ROOT}/packages/contracts/target/deploy/supply_chain.so"
else
  add_check "on-chain bytecode" "SKIP" "SOLANA_RPC_URL 未设置（链下验证模式）"
fi

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
if [[ "${code}" == "200" ]]; then
  add_check "pool overview public" "PASS" "HTTP ${code}"
else
  add_check "pool overview public" "FAIL" "HTTP ${code}, expected 200"
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
