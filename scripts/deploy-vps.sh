#!/usr/bin/env bash
# VPS-A 一键部署：构建镜像 -> 启动 -> 健康检查 -> 数据库迁移 ->（可选）种子管理员
# 用法：bash scripts/deploy-vps.sh [--skip-build] [--seed]
# 前置：deploy/vps/.env.app 已从 .env.app.example 复制并填写
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_DIR="${ROOT}/deploy/vps"
COMPOSE="docker compose --env-file ${ENV_FILE} -f ${COMPOSE_DIR}/app-compose.yml"
ENV_FILE="${COMPOSE_DIR}/.env.app"

SKIP_BUILD=0
DO_SEED=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --seed) DO_SEED=1 ;;
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

# 必需变量校验
for v in PUBLIC_BASE_URL NEXT_PUBLIC_BACKEND_URL DATABASE_URL REDIS_URL \
         SOLANA_RPC_URL JWT_SECRET ALLOWED_ORIGIN USDC_MINT LP_MINT \
         TRADE_FINANCE_PROGRAM_ID SUPPLY_CHAIN_PROGRAM_ID; do
  val="$(get_env "$v")"
  if [[ -z "$val" || "$val" == CHANGE_ME* ]]; then
    echo "ERROR: $v 未配置（或仍是 CHANGE_ME 占位）" >&2
    exit 1
  fi
done

echo "==> [1/5] 构建镜像 (PUBLIC_BASE_URL=${PUBLIC_BASE_URL})"
if [[ "$SKIP_BUILD" == "0" ]]; then
  (cd "$ROOT" && $COMPOSE build)
else
  echo "    跳过构建（--skip-build）"
fi

echo "==> [2/5] 启动服务"
$COMPOSE up -d

echo "==> [3/5] 等待健康检查"
declare -A HEALTH=([backend]=3001 [indexer]=3003 [trade]=3004 [pool]=3005 [frontend]=3000)
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
echo "部署完成：${PUBLIC_BASE_URL}"
echo "健康检查: curl -s https://${PUBLIC_BASE_URL#https://}/health"
echo "日志: docker compose -f ${COMPOSE_DIR}/app-compose.yml logs -f backend"
