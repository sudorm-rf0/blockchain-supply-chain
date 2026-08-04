#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-supply-chain}"
CERT_DIR="${CERT_DIR:-/tmp/supply-chain-tls}"

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-supply_chain}"
REDIS_PASSWORD="${REDIS_PASSWORD:-$(openssl rand -hex 16)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-}"
TRADE_FINANCE_PROGRAM_ID="${TRADE_FINANCE_PROGRAM_ID:-9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3}"
USDC_MINT="${USDC_MINT:-4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU}"
LP_MINT="${LP_MINT:-4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU}"
RISK_WEBHOOK_URL="${RISK_WEBHOOK_URL:-}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-$(openssl rand -hex 32)}"
POOL_STATE_ADDRESS="${POOL_STATE_ADDRESS:-}"

kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

kubectl -n "${NAMESPACE}" create secret generic backend-secrets \
  --from-literal=DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?connection_limit=5&schema=public" \
  --from-literal=REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD}" \
  --from-literal=POSTGRES_USER="${POSTGRES_USER}" \
  --from-literal=POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  --from-literal=POSTGRES_DB="${POSTGRES_DB}" \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=SOLANA_RPC_URL="${SOLANA_RPC_URL}" \
  --from-literal=TRADE_FINANCE_PROGRAM_ID="${TRADE_FINANCE_PROGRAM_ID}" \
  --from-literal=USDC_MINT="${USDC_MINT}" \
  --from-literal=LP_MINT="${LP_MINT}" \
  --from-literal=WEBHOOK_SECRET="${WEBHOOK_SECRET}" \
  --from-literal=POOL_STATE_ADDRESS="${POOL_STATE_ADDRESS}" \
  ${RISK_WEBHOOK_URL:+--from-literal=RISK_WEBHOOK_URL="${RISK_WEBHOOK_URL}"} \
  ${ALLOWED_ORIGIN:+--from-literal=ALLOWED_ORIGIN="${ALLOWED_ORIGIN}"} \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

if [[ -f "${CERT_DIR}/postgres/server.crt" ]]; then
  kubectl -n "${NAMESPACE}" create secret generic postgres-tls \
    --from-file="${CERT_DIR}/postgres/server.crt" \
    --from-file="${CERT_DIR}/postgres/server.key" \
    --from-file="${CERT_DIR}/postgres/ca.crt" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
fi

if [[ -f "${CERT_DIR}/redis/redis.crt" ]]; then
  kubectl -n "${NAMESPACE}" create secret generic redis-tls \
    --from-file="${CERT_DIR}/redis/redis.crt" \
    --from-file="${CERT_DIR}/redis/redis.key" \
    --from-file="${CERT_DIR}/redis/ca.crt" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
fi

echo "secrets created in namespace ${NAMESPACE}"
