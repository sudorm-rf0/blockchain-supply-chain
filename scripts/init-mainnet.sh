#!/usr/bin/env bash
# 主网链上初始化编排：资金池（真实 USDC 存款）→ 供应链注册中心/供应商
#
# 用法：
#   bash scripts/init-mainnet.sh --yes                     # 池初始化 + 存款
#   bash scripts/init-mainnet.sh --yes --skip-deposit      # 只初始化池，不存款
#   bash scripts/init-mainnet.sh --dry-run --yes           # 预览
#   bash scripts/init-mainnet.sh --yes <供应商公钥...>     # 池 + Registry 授权供应商
# 环境变量：见 init-mainnet-pool.mjs 头部 + SUPPLIERS（逗号分隔供应商，等价于位置参数）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${LOG_FILE:-/tmp/init-mainnet-$(date +%Y%m%d-%H%M%S).log}"
log() { echo "[$(date -u +%H:%M:%SZ)] $*" | tee -a "${LOG_FILE}"; }

YES=0
DRY_RUN=0
SKIP_DEPOSIT=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --skip-deposit) SKIP_DEPOSIT=1 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done
SUPPLIERS="${SUPPLIERS:-}"
if [[ -n "${SUPPLIERS}" ]]; then
  IFS=',' read -r -a SUPPLIER_ARRAY <<< "${SUPPLIERS}"
  POSITIONAL+=("${SUPPLIER_ARRAY[@]}")
fi

: "${SOLANA_RPC_URL:?必须设置 SOLANA_RPC_URL（主网）}"
case "${SOLANA_RPC_URL}" in
  *localhost*|*127.0.0.1*|*devnet*) echo "❌ SOLANA_RPC_URL 不能是 localhost/devnet" >&2; exit 1 ;;
esac
if [[ "${YES}" != "1" ]]; then
  echo "❌ 主网初始化涉及真实资金，必须传 --yes 确认（先用 --dry-run 预览）" >&2
  exit 1
fi

ARGS=()
[[ "${DRY_RUN}" == "1" ]] && ARGS+=(--dry-run)
[[ "${SKIP_DEPOSIT}" == "1" ]] && ARGS+=(--skip-deposit)
ARGS+=(--yes)

log "==> [1/2] 资金池初始化 + 存款（${SOLANA_RPC_URL}）"
node "${ROOT}/scripts/init-mainnet-pool.mjs" "${ARGS[@]}" 2>&1 | tee -a "${LOG_FILE}"

if [[ "${#POSITIONAL[@]}" -gt 0 ]]; then
  log "==> [2/2] 供应链注册中心 + 授权供应商"
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "  [dry-run] 将执行：node scripts/init-supply-chain.mjs ${POSITIONAL[*]}"
  else
    node "${ROOT}/scripts/init-supply-chain.mjs" "${POSITIONAL[@]}" 2>&1 | tee -a "${LOG_FILE}"
  fi
else
  log "==> [2/2] 跳过 Registry（未提供供应商公钥）；稍后单独运行："
  log "    node scripts/init-supply-chain.mjs <供应商公钥...>"
fi

echo "----------------------------------------"
echo "完成（日志：${LOG_FILE}）。输出变量（POOL/USDC_MINT/LP_MINT）用于配置服务环境变量。"
