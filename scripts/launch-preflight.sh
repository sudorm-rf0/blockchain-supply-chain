#!/usr/bin/env bash
# 主网上线预执行：一次串联 治理变量校验 + precheck + 部署（可选）+ 初始化/迁移指引。
#
# 用法：
#   bash scripts/launch-preflight.sh                  # 预检（校验 + precheck + 输出部署指引）
#   bash scripts/launch-preflight.sh --execute       # 预检通过后执行部署（UA 交给多签）
#   bash scripts/launch-preflight.sh --skip-precheck # 跳过 precheck（已通过时加速）
#
# Env（必填）：
#   SOLANA_RPC_URL / DEPLOY_WALLET / USDC_MINT / LP_MINT
#   TRADE_FINANCE_PROGRAM_ID / SUPPLY_CHAIN_PROGRAM_ID
#   MULTISIG_ADMIN（Squads PDA）/ UPGRADE_AUTHORITY_PLAN(cold-wallet|freeze) / INITIAL_ADMIN_DELAY(>=86400)
# 可选：MIN_BALANCE_SOL / EXPECT_POOL / REPORT_PATH / LOG_FILE
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXECUTE=0
SKIP_PRECHEck=0
for arg in "$@"; do
  case "$arg" in
    --execute) EXECUTE=1 ;;
    --skip-precheck) SKIP_PRECHEck=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

LOG_FILE="${LOG_FILE:-/tmp/launch-preflight-$(date +%Y%m%d-%H%M%S).log}"
log() { echo "[$(date -u +%H:%M:%SZ)] $*" | tee -a "${LOG_FILE}"; }

# ---------- 1. 必填环境校验 ----------
required=(SOLANA_RPC_URL DEPLOY_WALLET TRADE_FINANCE_PROGRAM_ID SUPPLY_CHAIN_PROGRAM_ID \
           USDC_MINT LP_MINT MULTISIG_ADMIN UPGRADE_AUTHORITY_PLAN INITIAL_ADMIN_DELAY)
missing=0
for v in "${required[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    echo "❌ 缺少必填环境变量: ${v}"; missing=1
  fi
done
[[ "$missing" == "1" ]] && exit 1

# 治理前置值校验
case "${UPGRADE_AUTHORITY_PLAN}" in
  cold-wallet|freeze) ;;
  *) echo "❌ UPGRADE_AUTHORITY_PLAN 必须是 cold-wallet 或 freeze" >&2; exit 1 ;;
esac
if ! awk -v d="${INITIAL_ADMIN_DELAY}" 'BEGIN { exit !(d >= 86400) }'; then
  echo "❌ INITIAL_ADMIN_DELAY 必须 >= 86400（当前 ${INITIAL_ADMIN_DELAY}）" >&2; exit 1
fi
if [[ "${DEPLOY_WALLET}" == "3rF9fK7KL2YmAsdGHFrsGTZHiKrqF7BRCZ88KRZ3nsK8" ]]; then
  echo "❌ DEPLOY_WALLET 不能是测试 DEPLOYER（N-05）" >&2; exit 1
fi

# ---------- 2. 上线计划 ----------
log "==> 主网上线预执行（launch-preflight）"
log "  RPC:            ${SOLANA_RPC_URL}"
log "  部署钱包:       ${DEPLOY_WALLET}"
log "  trade:          ${TRADE_FINANCE_PROGRAM_ID}"
log "  supply:         ${SUPPLY_CHAIN_PROGRAM_ID}"
log "  USDC/LP:        ${USDC_MINT} / ${LP_MINT}"
log "  多签(admin):    ${MULTISIG_ADMIN}"
log "  UA 处置:        ${UPGRADE_AUTHORITY_PLAN}"
log "  初始时锁:       ${INITIAL_ADMIN_DELAY}s"
echo "----------------------------------------" | tee -a "${LOG_FILE}"

# ---------- 3. precheck（强制） ----------
if [[ "${SKIP_PRECHEck}" == "1" ]]; then
  log "==> 跳过 precheck（--skip-precheck）"
else
  log "==> 运行 precheck-mainnet-deploy.sh"
  SOLANA_RPC_URL="${SOLANA_RPC_URL}" DEPLOY_WALLET="${DEPLOY_WALLET}" \
  TRADE_FINANCE_PROGRAM_ID="${TRADE_FINANCE_PROGRAM_ID}" SUPPLY_CHAIN_PROGRAM_ID="${SUPPLY_CHAIN_PROGRAM_ID}" \
  USDC_MINT="${USDC_MINT}" LP_MINT="${LP_MINT}" \
  UPGRADE_AUTHORITY_PLAN="${UPGRADE_AUTHORITY_PLAN}" \
  MULTISIG_ADMIN="${MULTISIG_ADMIN}" \
  INITIAL_ADMIN_DELAY="${INITIAL_ADMIN_DELAY}" \
  MIN_BALANCE_SOL="${MIN_BALANCE_SOL:-2}" EXPECT_POOL="${EXPECT_POOL:-absent}" \
  REPORT_PATH="${REPORT_PATH:-/tmp/mainnet-precheck-report.json}" \
  bash "${ROOT}/scripts/precheck-mainnet-deploy.sh" | tee -a "${LOG_FILE}"
fi

# ---------- 4. 执行部署（可选）或输出指引 ----------
if [[ "${EXECUTE}" == "1" ]]; then
  log "==> 执行部署（UA 交给多签 ${MULTISIG_ADMIN}）"
  SOLANA_RPC_URL="${SOLANA_RPC_URL}" DEPLOY_WALLET="${DEPLOY_WALLET}" \
  USDC_MINT="${USDC_MINT}" LP_MINT="${LP_MINT}" \
  bash "${ROOT}/scripts/deploy-mainnet.sh" --yes \
    --upgrade-authority "${MULTISIG_ADMIN}"
  log "==> 部署完成。下一步：由多签执行 initialize（见 Squads 手册场景 A）"
else
  echo "----------------------------------------" | tee -a "${LOG_FILE}"
  log "==> 预检完成。后续步骤（未自动执行）："
  cat <<GUIDE | tee -a "${LOG_FILE}"
  1) 部署（UA 交给多签）：
     SOLANA_RPC_URL=... DEPLOY_WALLET=... USDC_MINT=... LP_MINT=... \\
       bash scripts/deploy-mainnet.sh --yes --upgrade-authority ${MULTISIG_ADMIN}
  2) 初始化（由多签执行 initialize_pool / initialize_registry）：
     见 docs/Squads多签创建与Admin迁移手册.md 场景 A
  3) 验证：scripts/verify-contract-deployment.sh + smoke-e2e.mjs（小额冒烟）
  4) 完整链下验证：docs/链下系统上线检查清单.md
GUIDE
fi

log "==> 日志：${LOG_FILE}"
echo "launch-preflight 完成"
