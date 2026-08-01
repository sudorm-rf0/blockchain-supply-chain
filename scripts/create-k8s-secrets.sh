#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-supply-chain}"
CERT_DIR="${CERT_DIR:-/tmp/supply-chain-tls}"

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-supply_chain}"
REDIS_PASSWORD="${REDIS_PASSWORD:-$(openssl rand -hex 16)}"

kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

kubectl -n "${NAMESPACE}" create secret generic backend-secrets \
  --from-literal=DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public" \
  --from-literal=REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD}" \
  --from-literal=POSTGRES_USER="${POSTGRES_USER}" \
  --from-literal=POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  --from-literal=POSTGRES_DB="${POSTGRES_DB}" \
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
