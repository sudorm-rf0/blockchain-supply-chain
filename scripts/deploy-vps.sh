#!/usr/bin/env bash
# VPS-A 部署 / 本地排练
#   bash scripts/deploy-vps.sh                # 正式部署（构建+启动+迁移+健康检查）
#   bash scripts/deploy-vps.sh --skip-build   # 跳过镜像构建
#   bash scripts/deploy-vps.sh --seed         # 顺便种子管理员
#   bash scripts/deploy-vps.sh --rehearsal    # 本地排练（隔离容器/端口，跑完自动清理）
# 前置：deploy/vps/.env.app 已从 .env.app.example 复制并填写
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_DIR="${ROOT}/deploy/vps"
ENV_FILE="${COMPOSE_DIR}/.env.app"
COMPOSE_BASE="docker compose --env-file ${ENV_FILE} -f ${COMPOSE_DIR}/app-compose.yml"

SKIP_BUILD=0
DO_SEED=0
REHEARSAL=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --seed) DO_SEED=1 ;;
    --rehearsal) REHEARSAL=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE (cp .env.app.example .env.app and fill it)" >&2
  exit 1
fi

# 安全读取变量（.env 值含 & 等字符，不能直接 source）
get_env() {
  awk -F= -v k="$1" '$1==k{sub(/^[^=]*=/,""); print}' "$ENV_FILE"
}

if [[ "$REHEARSAL" == "1" ]]; then
  COMPOSE="${COMPOSE_BASE} -f ${COMPOSE_DIR}/app-compose.rehearsal.yml"
  if [[ -z "${REHEARSAL_DATABASE_URL:-}" || -z "${REHEARSAL_REDIS_URL:-}" ]]; then
    echo "ERROR: --rehearsal 需要 REHEARSAL_DATABASE_URL 和 REHEARSAL_REDIS_URL（指向本机测试库）" >&2
    echo "例如: REHEARSAL_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/supply_chain?connection_limit=10&schema=public' \\" >&2
    echo "      REHEARSAL_REDIS_URL='redis://127.0.0.1:6380' bash scripts/deploy-vps.sh --rehearsal" >&2
    exit 1
  fi
  echo "==> 本地排练模式（容器名 vps-reh-*，nginx 8080，跑完自动清理）"
else
  COMPOSE="$COMPOSE_BASE"
fi

# 必需变量校验（排练同样需要，服务启动依赖）
for v in NEXT_PUBLIC_BACKEND_URL DATABASE_URL REDIS_URL \
         SOLANA_RPC_URL JWT_SECRET USDC_MINT LP_MINT \
         TRADE_FINANCE_PROGRAM_ID SUPPLY_CHAIN_PROGRAM_ID; do
  val="$(get_env "$v")"
  if [[ -z "$val" || "$val" == CHANGE_ME* ]]; then
    echo "ERROR: $v 未配置（或仍是 CHANGE_ME 占位）" >&2
    exit 1
  fi
done

echo "==> [1/5] 构建镜像"
if [[ "$SKIP_BUILD" == "0" ]]; then
  (cd "$ROOT" && $COMPOSE build)
else
  echo "    跳过构建（--skip-build）"
fi

echo "==> [2/5] 启动服务"
$COMPOSE up -d

cleanup() {
  if [[ "$REHEARSAL" == "1" ]]; then
    echo "==> 排练结束，清理容器"
    $COMPOSE down --volumes >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "==> [3/5] 等待健康检查"
declare -A HEALTH=([backend]=3001 [indexer]=3003 [trade]=3004 [pool]=3005 [frontend]=3000)
ok=0
for i in $(seq 1 30); do
  ok=1
  for svc in "${!HEALTH[@]}"; do
    if ! curl -sf -m 3 "http://localhost:${HEALTH[$svc]}/health" >/dev/null 2>&1 \
       && [[ "$svc" != "frontend" ]]; then
      ok=0
    fi
  done
  [[ "$ok" == "1" ]] && break
  sleep 5
done
$COMPOSE ps
if [[ "$ok" != "1" ]]; then
  echo "ERROR: 健康检查未通过" >&2
  exit 1
fi

echo "==> [4/5] 数据库迁移"
$COMPOSE exec -T backend npm run prisma:deploy

SEED_PW="$(get_env ADMIN_PASSWORD)"
if [[ "$DO_SEED" == "1" && -n "$SEED_PW" && "$SEED_PW" != CHANGE_ME* ]]; then
  echo "==> [5/5] 种子管理员 admin@supply-chain.io"
  $COMPOSE exec -T -e ADMIN_PASSWORD="$SEED_PW" backend npm run prisma:seed
else
  echo "==> [5/5] 跳过种子（--seed 且 ADMIN_PASSWORD 已配置时才会执行）"
fi

echo "----------------------------------------"
if [[ "$REHEARSAL" == "1" ]]; then
  echo "排练完成：http://localhost:8080（nginx 已就绪，容器将自动清理）"
  if [[ -n "${SMOKE_BACKEND_URL:-}" ]]; then
    echo "==> 可选冒烟：BACKEND_URL=$SMOKE_BACKEND_URL ..."
  fi
else
  echo "部署完成：$(get_env PUBLIC_BASE_URL)"
  echo "健康检查: curl -s https://${PUBLIC_BASE_URL#https://}/health"
  echo "日志: docker compose -f ${COMPOSE_DIR}/app-compose.yml logs -f backend"
fi
