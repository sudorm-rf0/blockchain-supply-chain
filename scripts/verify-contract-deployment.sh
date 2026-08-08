#!/usr/bin/env bash
# 合约部署后校验：Program 可执行、PoolState 已初始化、USDC/LP Mint 存在、部署钱包有余额。
# 用法：bash scripts/verify-contract-deployment.sh
# Env:
#   SOLANA_RPC_URL=https://api.devnet.solana.com
#   TRADE_FINANCE_PROGRAM_ID=...
#   USDC_MINT=... / LP_MINT=...（可选，配置后校验 Mint 账户）
#   ADMIN_WALLET=...（可选，配置后校验余额 > 0）
#   REQUIRE_POOL=1（默认校验 PoolState 已初始化；纯部署校验可设 0）
#   REPORT_PATH=/tmp/contract-verify-report.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 审计 M-04（第三轮）：路径自适应 —— 真实仓库布局 packages/contracts，
# 审计包布局 contracts/，两者均可直接执行；backend 目录不存在时告警跳过。
if [[ -d "${ROOT}/packages/contracts" ]]; then
  CONTRACTS_DIR="${ROOT}/packages/contracts"
else
  CONTRACTS_DIR="${ROOT}/contracts"
fi
if [[ -d "${ROOT}/packages/backend" ]]; then
  BACKEND_DIR="${ROOT}/packages/backend"
elif [[ -d "${ROOT}/backend" ]]; then
  BACKEND_DIR="${ROOT}/backend"
else
  BACKEND_DIR=""
fi
RPC="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
PROGRAM_ID="${TRADE_FINANCE_PROGRAM_ID:-9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3}"
USDC_MINT="${USDC_MINT:-}"
LP_MINT="${LP_MINT:-}"
ADMIN_WALLET="${ADMIN_WALLET:-}"
REQUIRE_POOL="${REQUIRE_POOL:-1}"
REPORT_PATH="${REPORT_PATH:-/tmp/contract-verify-report.json}"
TOKEN_PROGRAM="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
BPF_LOADER="BPFLoaderUpgradeab1e11111111111111111111111"

checks=()

add_check() {
  local name="$1" status="$2" detail="$3"
  checks+=("$(jq -cn --arg name "${name}" --arg status "${status}" --arg detail "${detail}" \
    '{name: $name, status: $status, detail: $detail}')")
}

rpc() {
  local method="$1" params="$2"
  curl -sS --max-time 15 -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"${method}\",\"params\":${params}}" \
    "${RPC}" || echo '{"jsonrpc":"2.0","id":1,"result":null}'
}

account_exists() {
  local address="$1"
  rpc getAccountInfo "[\"${address}\",{\"encoding\":\"base64\"}]" | jq -r '.result.value != null'
}

pool_pda() {
  # 审计 M-04：backend 目录缺失（审计包内无 backend/）时返回空并由调用处 SKIP。
  if [[ -z "${BACKEND_DIR}" ]]; then
    echo ""
    return
  fi
  (
    cd "${BACKEND_DIR}"
    node - "${PROGRAM_ID}" <<'NODE'
const { PublicKey } = require("@solana/web3.js");
const programId = new PublicKey(process.argv[2]);
const [pool] = PublicKey.findProgramAddressSync(
  [Buffer.from("trade_finance"), Buffer.from("pool")],
  programId,
);
console.log(pool.toBase58());
NODE
  )
}

start_ts="$(date +%s)"

echo "=== contract deployment verification $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# --------------- Program ---------------
PROGRAM="$(rpc getAccountInfo "[\"${PROGRAM_ID}\",{\"encoding\":\"base64\"}]")"
if printf '%s' "${PROGRAM}" | jq -e '.result.value.executable == true and .result.value.owner == "'"${BPF_LOADER}"'"' >/dev/null 2>&1; then
  add_check "program executable" "PASS" "${PROGRAM_ID}"
else
  add_check "program executable" "FAIL" "${PROGRAM_ID} not executable on ${RPC}"
fi

# --------------- Pool state ---------------
if [[ "${REQUIRE_POOL}" == "1" ]]; then
  POOL_PDA="$(pool_pda)"
  if [[ -z "${POOL_PDA}" ]]; then
    add_check "pool state initialized" "SKIP" "backend 缺失（审计包内无 backend/），跳过 PDA 计算"
  elif [[ "$(account_exists "${POOL_PDA}")" == "true" ]]; then
    add_check "pool state initialized" "PASS" "${POOL_PDA}"
  else
    add_check "pool state initialized" "FAIL" "${POOL_PDA} not found"
  fi
fi

# --------------- Token mints ---------------
if [[ -n "${USDC_MINT}" ]]; then
  ACCOUNT="$(rpc getAccountInfo "[\"${USDC_MINT}\",{\"encoding\":\"base64\"}]")"
  if printf '%s' "${ACCOUNT}" | jq -e '.result.value != null and .result.value.owner == "'"${TOKEN_PROGRAM}"'"' >/dev/null 2>&1; then
    add_check "usdc mint" "PASS" "${USDC_MINT}"
  else
    add_check "usdc mint" "FAIL" "${USDC_MINT} missing or not SPL token"
  fi
fi
if [[ -n "${LP_MINT}" ]]; then
  ACCOUNT="$(rpc getAccountInfo "[\"${LP_MINT}\",{\"encoding\":\"base64\"}]")"
  if printf '%s' "${ACCOUNT}" | jq -e '.result.value != null and .result.value.owner == "'"${TOKEN_PROGRAM}"'"' >/dev/null 2>&1; then
    add_check "lp mint" "PASS" "${LP_MINT}"
  else
    add_check "lp mint" "FAIL" "${LP_MINT} missing or not SPL token"
  fi
fi

# --------------- Deploy wallet ---------------
if [[ -n "${ADMIN_WALLET}" ]]; then
  BALANCE="$(rpc getBalance "[\"${ADMIN_WALLET}\"]" | jq -r '.result.value // 0')"
  if [[ "${BALANCE}" -gt 0 ]]; then
    add_check "admin wallet balance" "PASS" "${BALANCE} lamports"
  else
    add_check "admin wallet balance" "FAIL" "${ADMIN_WALLET} has 0 lamports"
  fi
fi

duration="$(( $(date +%s) - start_ts ))"
failures="$(printf '%s\n' "${checks[@]}" | jq -r 'select(.status == "FAIL") | .name' | wc -l | tr -d '[:space:]')"
ok="true"
if [[ "${failures}" -gt 0 ]]; then ok="false"; fi

checks_json="$(printf '%s\n' "${checks[@]}" | jq -s .)"
jq -n \
  --arg rpc "${RPC}" \
  --arg programId "${PROGRAM_ID}" \
  --argjson ok "${ok}" \
  --argjson duration "${duration}" \
  --argjson checks "${checks_json}" \
  '{ok: $ok, rpc: $rpc, programId: $programId, durationSeconds: $duration, checks: $checks}' \
  > "${REPORT_PATH}"

echo "----------------------------------------"
echo "contract verification report: ${REPORT_PATH}"
cat "${REPORT_PATH}"
echo "----------------------------------------"

if [[ "${ok}" == "true" ]]; then
  echo "contract deployment verification passed"
else
  echo "contract deployment verification FAILED" >&2
  exit 1
fi
