#!/usr/bin/env bash
# 主网部署预检：RPC 可达、部署钱包余额、代币 Mint、Program ID 非 dev 占位、
# PoolState 状态符合预期。全部通过才允许执行 deploy-devnet.sh。
# 用法：bash scripts/precheck-mainnet-deploy.sh
# Env:
#   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
#   DEPLOY_WALLET=...
#   TRADE_FINANCE_PROGRAM_ID=... / SUPPLY_CHAIN_PROGRAM_ID=...
#   USDC_MINT=... / LP_MINT=...
#   EXPECT_POOL=absent（默认；重复部署可设 present）
#   MIN_BALANCE_SOL=1
#   REPORT_PATH=/tmp/mainnet-precheck-report.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="${SOLANA_RPC_URL:-}"
DEPLOY_WALLET="${DEPLOY_WALLET:-}"
TRADE_PROGRAM="${TRADE_FINANCE_PROGRAM_ID:-}"
SUPPLY_PROGRAM="${SUPPLY_CHAIN_PROGRAM_ID:-}"
USDC_MINT="${USDC_MINT:-}"
LP_MINT="${LP_MINT:-}"
EXPECT_POOL="${EXPECT_POOL:-absent}"
MIN_BALANCE_SOL="${MIN_BALANCE_SOL:-1}"
REPORT_PATH="${REPORT_PATH:-/tmp/mainnet-precheck-report.json}"
TOKEN_PROGRAM="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
DEV_TRADE_PROGRAM="9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3"
DEV_SUPPLY_PROGRAM="Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk"

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
  (
    cd "${ROOT}/packages/backend"
    node - "${TRADE_PROGRAM}" <<'NODE'
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

echo "=== mainnet precheck $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

if [[ -z "${RPC}" || "${RPC}" == *"localhost"* || "${RPC}" == *"127.0.0.1"* ]]; then
  add_check "rpc endpoint" "FAIL" "SOLANA_RPC_URL must be a real non-local endpoint"
else
  if rpc getHealth "[]" | jq -e '.result == "ok"' >/dev/null 2>&1; then
    add_check "rpc endpoint" "PASS" "${RPC}"
  else
    add_check "rpc endpoint" "FAIL" "${RPC} unhealthy"
  fi
fi

if [[ -z "${DEPLOY_WALLET}" ]]; then
  add_check "deploy wallet" "FAIL" "DEPLOY_WALLET is required"
else
  BALANCE="$(rpc getBalance "[\"${DEPLOY_WALLET}\"]" | jq -r '.result.value // 0')"
  SOL="$(awk -v l="$BALANCE" 'BEGIN { printf "%.3f", l / 1000000000 }')"
  if awk -v b="$BALANCE" -v min="$MIN_BALANCE_SOL" 'BEGIN { exit !(b/1000000000 >= min) }'; then
    add_check "deploy wallet" "PASS" "${SOL} SOL"
  else
    add_check "deploy wallet" "FAIL" "${SOL} SOL, minimum ${MIN_BALANCE_SOL}"
  fi
fi

if [[ -z "${TRADE_PROGRAM}" || -z "${SUPPLY_PROGRAM}" ]]; then
  add_check "program ids" "FAIL" "TRADE_FINANCE_PROGRAM_ID and SUPPLY_CHAIN_PROGRAM_ID are required"
else
  if [[ "${TRADE_PROGRAM}" == "${DEV_TRADE_PROGRAM}" || "${SUPPLY_PROGRAM}" == "${DEV_SUPPLY_PROGRAM}" ]]; then
    add_check "program ids" "FAIL" "dev placeholder program ids must not be used on mainnet"
  else
    add_check "program ids" "PASS" "trade=${TRADE_PROGRAM} supply=${SUPPLY_PROGRAM}"
  fi
fi

for pair in "usdc mint:${USDC_MINT}" "lp mint:${LP_MINT}"; do
  name="${pair%%:*}"; address="${pair#*:}"
  if [[ -z "${address}" ]]; then
    add_check "${name}" "FAIL" "required mint address is empty"
    continue
  fi
  if rpc getAccountInfo "[\"${address}\",{\"encoding\":\"base64\"}]" | \
      jq -e '.result.value != null and .result.value.owner == "'"${TOKEN_PROGRAM}"'"' >/dev/null 2>&1; then
    add_check "${name}" "PASS" "${address}"
  else
    add_check "${name}" "FAIL" "${address} missing or not SPL token"
  fi
done

if [[ -n "${TRADE_PROGRAM}" && "${TRADE_PROGRAM}" != "${DEV_TRADE_PROGRAM}" ]]; then
  POOL_PDA="$(pool_pda)"
  EXISTS="$(account_exists "${POOL_PDA}")"
  if [[ "${EXPECT_POOL}" == "absent" && "${EXISTS}" == "true" ]]; then
    add_check "pool state" "FAIL" "already initialized at ${POOL_PDA}; use EXPECT_POOL=present to allow"
  elif [[ "${EXPECT_POOL}" == "present" && "${EXISTS}" == "false" ]]; then
    add_check "pool state" "FAIL" "expected initialized at ${POOL_PDA}"
  else
    add_check "pool state" "PASS" "expected=${EXPECT_POOL} at ${POOL_PDA}"
  fi
fi

duration="$(( $(date +%s) - start_ts ))"
failures="$(printf '%s\n' "${checks[@]}" | jq -r 'select(.status == "FAIL") | .name' | wc -l | tr -d '[:space:]')"
ok="true"
if [[ "${failures}" -gt 0 ]]; then ok="false"; fi

checks_json="$(printf '%s\n' "${checks[@]}" | jq -s .)"
jq -n \
  --arg rpc "${RPC}" \
  --argjson ok "${ok}" \
  --argjson duration "${duration}" \
  --argjson checks "${checks_json}" \
  '{ok: $ok, rpc: $rpc, durationSeconds: $duration, checks: $checks}' \
  > "${REPORT_PATH}"

echo "----------------------------------------"
echo "mainnet precheck report: ${REPORT_PATH}"
cat "${REPORT_PATH}"
echo "----------------------------------------"

if [[ "${ok}" == "true" ]]; then
  echo "mainnet precheck passed"
else
  echo "mainnet precheck FAILED" >&2
  exit 1
fi
