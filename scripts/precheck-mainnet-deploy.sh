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
RPC="${SOLANA_RPC_URL:-}"
DEPLOY_WALLET="${DEPLOY_WALLET:-}"
TRADE_PROGRAM="${TRADE_FINANCE_PROGRAM_ID:-}"
SUPPLY_PROGRAM="${SUPPLY_CHAIN_PROGRAM_ID:-}"
USDC_MINT="${USDC_MINT:-}"
LP_MINT="${LP_MINT:-}"
EXPECT_POOL="${EXPECT_POOL:-absent}"
MIN_BALANCE_SOL="${MIN_BALANCE_SOL:-1}"
REPORT_PATH="${REPORT_PATH:-/tmp/mainnet-precheck-report.json}"
# 审计 N-05/N-03/L-13 主网治理前置
#   TEST_DEPLOYER=开发/测试 DEPLOYER（主网部署钱包不得等于它）
#   UPGRADE_AUTHORITY_PLAN=cold-wallet|freeze  升级权限处置计划
#   MULTISIG_ADMIN=<Squads 多签 PDA>            资金池/注册中心管理员应指向多签
#   INITIAL_ADMIN_DELAY=<秒，>=86400>           初始化时锁下限
TEST_DEPLOYER="3rF9fK7KL2YmAsdGHFrsGTZHiKrqF7BRCZ88KRZ3nsK8"
UPGRADE_AUTHORITY_PLAN="${UPGRADE_AUTHORITY_PLAN:-}"
MULTISIG_ADMIN="${MULTISIG_ADMIN:-}"
INITIAL_ADMIN_DELAY="${INITIAL_ADMIN_DELAY:-}" 
TOKEN_PROGRAM="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
DEV_TRADE_PROGRAM="9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3"
DEV_SUPPLY_PROGRAM="Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk"
# 审计 M-05：部署字节码 declare_id! 必须与部署 keypair 的 Program ID 一致
TRADE_KEYPAIR="${TRADE_KEYPAIR:-${CONTRACTS_DIR}/target/deploy/mainnet/trade_finance-keypair.json}"
SUPPLY_KEYPAIR="${SUPPLY_KEYPAIR:-${CONTRACTS_DIR}/target/deploy/mainnet/supply_chain-keypair.json}"

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
  # 审计 M-04：backend 目录缺失（审计包内无 backend/）时无法从 backend 解析
  # @solana/web3.js，退化为返回空并由调用处标记 SKIP，而不是让脚本中断。
  if [[ -z "${BACKEND_DIR}" ]]; then
    echo ""
    return
  fi
  (
    cd "${BACKEND_DIR}"
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

# 审计 N-05：主网部署钱包不得等于测试 DEPLOYER（硬编码测试钱包在主网无效）
if [[ -n "${DEPLOY_WALLET}" && "${DEPLOY_WALLET}" == "${TEST_DEPLOYER}" ]]; then
  add_check "deploy wallet" "FAIL" "DEPLOY_WALLET equals the test DEPLOYER (${TEST_DEPLOYER}); use a dedicated cold wallet"
fi
# 审计 N-05：必须声明 upgrade authority 处置计划（冷钱包保留或冻结）
if [[ -z "${UPGRADE_AUTHORITY_PLAN}" ]]; then
  add_check "upgrade authority plan" "FAIL" "UPGRADE_AUTHORITY_PLAN must be 'cold-wallet' or 'freeze'"
elif [[ "${UPGRADE_AUTHORITY_PLAN}" != "cold-wallet" && "${UPGRADE_AUTHORITY_PLAN}" != "freeze" ]]; then
  add_check "upgrade authority plan" "FAIL" "UPGRADE_AUTHORITY_PLAN=${UPGRADE_AUTHORITY_PLAN} invalid (cold-wallet|freeze)"
else
  add_check "upgrade authority plan" "PASS" "${UPGRADE_AUTHORITY_PLAN}"
fi

# 独立复测 H-2：test-build 特性是主网后门开关，禁止默认启用或在主网构建命令中出现
if grep -qE '^default\s*=.*test-build' "${CONTRACTS_DIR}/programs/trade-finance/Cargo.toml" "${CONTRACTS_DIR}/programs/supply-chain/Cargo.toml" 2>/dev/null; then
  add_check "test-build default feature" "FAIL" "test-build 被设为默认特性，主网构建将引入测试构建特性（仅放宽 initial_delay，无白名单后门；主网仍禁止）"
fi
if grep -qE '--features.*test-build' "${ROOT}/scripts/deploy-mainnet.sh" 2>/dev/null; then
  add_check "deploy build features" "FAIL" "deploy-mainnet.sh 构建命令携带 test-build 特性"
fi

# 审计 M-05：部署字节码 declare_id! 必须与部署 keypair 的 Program ID 一致
# （否则 C-1 program_data PDA 绑定与全部账户派生按旧 ID 计算，主网程序不可用）
declare_id_of() {
  grep -oE 'declare_id!\("[1-9A-HJ-NP-Za-km-z]{32,44}"\)' "$1" 2>/dev/null \
    | grep -oE '"[1-9A-HJ-NP-Za-km-z]{32,44}"' | tr -d '"' | head -1
}
check_declare_id_consistency() {
  local name="$1" kp="$2" lib="$3"
  if [[ ! -f "${kp}" ]]; then
    add_check "M-05 ${name} Program ID 一致性" "WARN" "keypair 不存在（${kp}）；主网部署前需先生成/指定"
    return
  fi
  local kp_id declare_id
  kp_id="$(solana-keygen pubkey "${kp}" 2>/dev/null || true)"
  declare_id="$(declare_id_of "${lib}")"
  if [[ -n "${kp_id}" && -n "${declare_id}" && "${kp_id}" == "${declare_id}" ]]; then
    add_check "M-05 ${name} Program ID 一致性" "PASS" "keypair ID == declare_id! (${declare_id})"
  else
    add_check "M-05 ${name} Program ID 一致性" "FAIL" "keypair(${kp_id:-?}) != declare_id!(${declare_id:-?})；需先 anchor keys sync / deploy-mainnet.sh --generate-keypairs 同步后重建"
  fi
}
check_declare_id_consistency "trade" "${TRADE_KEYPAIR}" "${CONTRACTS_DIR}/programs/trade-finance/src/lib.rs"
check_declare_id_consistency "supply" "${SUPPLY_KEYPAIR}" "${CONTRACTS_DIR}/programs/supply-chain/src/lib.rs"

# 审计 M-05（supply-chain-audit 2026-08-08）：Anchor.toml [programs.mainnet] 不得仍是
# devnet 占位 ID；主网部署前必须已用 --generate-keypairs / anchor keys sync 同步。
ANCHOR_TOML="${CONTRACTS_DIR}/Anchor.toml"
MAINNET_SEC="$(sed -n '/\[programs.mainnet\]/,/^\[/p' "${ANCHOR_TOML}" 2>/dev/null)"
if [[ -z "${MAINNET_SEC}" ]]; then
  add_check "M-05 mainnet Program ID" "FAIL" "Anchor.toml 缺 [programs.mainnet] 段"
elif printf '%s' "${MAINNET_SEC}" | grep -qE 'trade_finance = "9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3"|supply_chain = "Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk"'; then
  add_check "M-05 mainnet Program ID" "FAIL" "Anchor.toml [programs.mainnet] 仍为 devnet 占位 ID；须先 --generate-keypairs 同步 declare_id! 与 Anchor.toml"
else
  add_check "M-05 mainnet Program ID" "PASS" "Anchor.toml [programs.mainnet] 已同步（非 devnet 占位）"
fi

# 审计 L-13：初始化时锁必须 >= 86400s（生产），杜绝初始化路径无时锁
if [[ -z "${INITIAL_ADMIN_DELAY}" ]]; then
  add_check "initial admin delay" "FAIL" "INITIAL_ADMIN_DELAY must be set (>= 86400) for initialize_*"
elif awk -v d="${INITIAL_ADMIN_DELAY}" 'BEGIN { exit !(d >= 86400) }'; then
  add_check "initial admin delay" "PASS" "${INITIAL_ADMIN_DELAY}s"
else
  add_check "initial admin delay" "FAIL" "INITIAL_ADMIN_DELAY=${INITIAL_ADMIN_DELAY} < 86400; initialize_* would have no meaningful lock"
fi

# 审计 N-03：主网管理员应指向 Squads 多签（不阻塞，但必须显式声明）
if [[ -z "${MULTISIG_ADMIN}" ]]; then
  add_check "multisig admin" "WARN" "MULTISIG_ADMIN not set; pool/registry admin must point to a Squads multisig PDA before launch"
else
  add_check "multisig admin" "PASS" "${MULTISIG_ADMIN}"
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
  if [[ -z "${POOL_PDA}" ]]; then
    add_check "pool state" "SKIP" "backend 缺失（审计包内无 backend/），跳过 PDA 计算"
  else
  EXISTS="$(account_exists "${POOL_PDA}")"
  if [[ "${EXPECT_POOL}" == "absent" && "${EXISTS}" == "true" ]]; then
    add_check "pool state" "FAIL" "already initialized at ${POOL_PDA}; use EXPECT_POOL=present to allow"
  elif [[ "${EXPECT_POOL}" == "present" && "${EXISTS}" == "false" ]]; then
    add_check "pool state" "FAIL" "expected initialized at ${POOL_PDA}"
  else
    add_check "pool state" "PASS" "expected=${EXPECT_POOL} at ${POOL_PDA}"
  fi
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
