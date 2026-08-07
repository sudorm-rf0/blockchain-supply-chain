#!/usr/bin/env bash
# Staging 部署验证跑批：把链下系统验证串成一条命令。
#
# 顺序：健康检查 → 部署验证(+可选冒烟) → 监控验证 → 备份/恢复演练 → 回滚演练 → 链上/DB 对账
#
# 用法：
#   bash scripts/staging-verify.sh --env-file deploy/vps/.env.app
#   bash scripts/staging-verify.sh --env-file <file> --deploy-staging   # 先部署 staging（VPS rehearsal 或 --skip-build）
#   bash scripts/staging-verify.sh --env-file <file> --domain            # 使用 PUBLIC_BASE_URL 域名模式
#   bash scripts/staging-verify.sh --env-file <file> --skip-monitoring --skip-backup --skip-rollback --skip-reconcile
#   bash scripts/staging-verify.sh --env-file <file> --json --fail-fast
#
# Env（除 env 文件外可覆盖）：
#   BACKEND_URL/TRADE_URL/POOL_URL/INDEXER_URL/FRONTEND_URL/SOLANA_RPC_URL
#   DATABASE_URL/CONTAINER/NAMESPACE/DEPLOYMENT/REGISTRY/PREVIOUS_TAG
#   TRADE_FINANCE_PROGRAM_ID/USDC_MINT/RUN_SMOKE
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE=""
DEPLOY_STAGING=0
DOMAIN_MODE=0
FAIL_FAST=0
JSON=0
SKIP=( )
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --deploy-staging) DEPLOY_STAGING=1; shift ;;
    --domain) DOMAIN_MODE=1; shift ;;
    --fail-fast) FAIL_FAST=1; shift ;;
    --json) JSON=1; shift ;;
    --skip-health) SKIP+=(health); shift ;;
    --skip-deploy-verify) SKIP+=(deploy_verify); shift ;;
    --skip-monitoring) SKIP+=(monitoring); shift ;;
    --skip-backup) SKIP+=(backup); shift ;;
    --skip-rollback) SKIP+=(rollback); shift ;;
    --skip-reconcile) SKIP+=(reconcile); shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

skip() { for s in "${SKIP[@]:-}"; do [[ "$s" == "$1" ]] && return 0; done; return 1; }

# ---------- 0. 加载 env ----------
if [[ -z "${ENV_FILE}" ]]; then
  if [[ -f "${ROOT}/deploy/vps/.env.app" ]]; then ENV_FILE="${ROOT}/deploy/vps/.env.app"; else
    echo "❌ 未指定 --env-file（且 deploy/vps/.env.app 不存在）"; exit 1
  fi
fi
# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

# ---------- 0.1 可选：部署 staging ----------
if [[ "${DEPLOY_STAGING}" == "1" ]]; then
  echo "==> 部署 staging..."
  REHEARSAL_DATABASE_URL="${REHEARSAL_DATABASE_URL:-${DATABASE_URL}}" \
  REHEARSAL_REDIS_URL="${REHEARSAL_REDIS_URL:-${REDIS_URL}}" \
    bash "${ROOT}/scripts/deploy-vps.sh" --rehearsal 2>&1 | tail -6 || { echo "❌ staging 部署失败"; exit 1; }
fi

# ---------- 0.2 推导服务 URL ----------
BASE="http://localhost"
if [[ "${DOMAIN_MODE}" == "1" && -n "${PUBLIC_BASE_URL:-}" && "${PUBLIC_BASE_URL}" != *"example.com"* ]]; then
  BASE="${PUBLIC_BASE_URL}"
fi
BACKEND_URL="${BACKEND_URL:-${BASE}}"
TRADE_URL="${TRADE_URL:-${BASE}:3004}"
POOL_URL="${POOL_URL:-${BASE}:3005}"
INDEXER_URL="${INDEXER_URL:-${BASE}:3003}"
FRONTEND_URL="${FRONTEND_URL:-${BASE}:3000}"
SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
SERVICES="${SERVICES:-3001 backend,3003 indexer,3004 trade,3005 pool}"

REPORT_DIR="${REPORT_DIR:-/tmp/staging-verify}"
mkdir -p "${REPORT_DIR}"
summary=()

run_step() {
  local name="$1"; shift
  if skip "$name"; then summary+=("${name}=SKIPPED"); echo "[SKIP] ${name}"; return 0; fi
  echo "==> [${name}] $*"
  if "$@" >"${REPORT_DIR}/${name}.log" 2>&1; then
    summary+=("${name}=PASS"); echo "  ✅ ${name} PASS（日志 ${REPORT_DIR}/${name}.log）"
  else
    summary+=("${name}=FAIL"); echo "  ❌ ${name} FAIL（日志 ${REPORT_DIR}/${name}.log）"
    [[ "${FAIL_FAST}" == "1" ]] && { tail -20 "${REPORT_DIR}/${name}.log" >&2; exit 1; }
  fi
}

# ---------- 1. 健康检查 ----------
run_step health bash "${ROOT}/scripts/health-check.sh"

# ---------- 2. 部署验证（可选冒烟） ----------
run_step deploy_verify env \
  BACKEND_URL="${BACKEND_URL}" TRADE_URL="${TRADE_URL}" POOL_URL="${POOL_URL}" \
  INDEXER_URL="${INDEXER_URL}" FRONTEND_URL="${FRONTEND_URL}" \
  RUN_SMOKE="${RUN_SMOKE:-0}" \
  bash "${ROOT}/scripts/verify-deployment.sh"

# ---------- 3. 监控验证 ----------
run_step monitoring env \
  SERVICES="${SERVICES}" PROMETHEUS_URL="${PROMETHEUS_URL:-}" GRAFANA_URL="${GRAFANA_URL:-}" \
  bash "${ROOT}/scripts/verify-monitoring.sh"

# ---------- 4. 备份/恢复演练 ----------
run_step backup env \
  DATABASE_URL="${DATABASE_URL}" CONTAINER="${CONTAINER:-supply-chain-postgres}" \
  bash "${ROOT}/scripts/db-backup-restore.sh" drill

# ---------- 5. 回滚演练（默认 dry-run 校验） ----------
run_step rollback env \
  NAMESPACE="${NAMESPACE:-supply-chain}" DEPLOYMENT="${DEPLOYMENT:-backend}" \
  REGISTRY="${REGISTRY:-}" PREVIOUS_TAG="${PREVIOUS_TAG:-}" DRY_RUN=1 \
  bash "${ROOT}/scripts/rollback-drill.sh"

# ---------- 6. 链上/DB 对账 ----------
run_step reconcile env \
  SOLANA_RPC_URL="${SOLANA_RPC_URL}" DATABASE_URL="${DATABASE_URL}" \
  TRADE_FINANCE_PROGRAM_ID="${TRADE_FINANCE_PROGRAM_ID:-}" USDC_MINT="${USDC_MINT:-}" \
  bash "${ROOT}/scripts/reconcile.sh"

# ---------- 汇总 ----------
echo "========================================"
echo "Staging 验证汇总"
PASS=0; FAIL=0
for s in "${summary[@]}"; do
  echo "  ${s}"
  [[ "$s" == *"=PASS" ]] && PASS=$((PASS+1))
  [[ "$s" == *"=FAIL" ]] && FAIL=$((FAIL+1))
done
echo "  PASS=${PASS} FAIL=${FAIL}"
if [[ "${JSON}" == "1" ]]; then
  python3 -c "
import json
s='${summary[*]}'.split()
print(json.dumps({'steps': [dict(zip(['name','result'],[x.split('=')[0], x.split('=')[1]])) for x in s], 'pass': ${PASS}, 'fail': ${FAIL}}))
" > "${REPORT_DIR}/summary.json"
  echo "  报告：${REPORT_DIR}/summary.json"
fi
echo "========================================"
if [[ "${FAIL}" -gt 0 ]]; then echo "staging-verify: FAILED" >&2; exit 1; fi
echo "staging-verify: ALL PASS"
