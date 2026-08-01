#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="${CERT_DIR:-/tmp/supply-chain-tls}"
mkdir -p "${CERT_DIR}/postgres" "${CERT_DIR}/redis"

openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout "${CERT_DIR}/ca.key" \
  -out "${CERT_DIR}/ca.crt" \
  -subj "/CN=supply-chain-ca"

openssl req -newkey rsa:2048 -nodes \
  -keyout "${CERT_DIR}/postgres/server.key" \
  -out "${CERT_DIR}/postgres/server.csr" \
  -subj "/CN=postgres.supply-chain.svc.cluster.local"

cat > "${CERT_DIR}/postgres/ext.cnf" <<EOF
subjectAltName = DNS:postgres,DNS:postgres.supply-chain.svc.cluster.local
extendedKeyUsage = serverAuth
EOF

openssl x509 -req -days 365 \
  -in "${CERT_DIR}/postgres/server.csr" \
  -CA "${CERT_DIR}/ca.crt" \
  -CAkey "${CERT_DIR}/ca.key" \
  -CAcreateserial \
  -out "${CERT_DIR}/postgres/server.crt" \
  -extfile "${CERT_DIR}/postgres/ext.cnf"
cp "${CERT_DIR}/ca.crt" "${CERT_DIR}/postgres/ca.crt"

openssl req -newkey rsa:2048 -nodes \
  -keyout "${CERT_DIR}/redis/redis.key" \
  -out "${CERT_DIR}/redis/redis.csr" \
  -subj "/CN=redis.supply-chain.svc.cluster.local"

cat > "${CERT_DIR}/redis/ext.cnf" <<EOF
subjectAltName = DNS:redis,DNS:redis.supply-chain.svc.cluster.local
extendedKeyUsage = serverAuth
EOF

openssl x509 -req -days 365 \
  -in "${CERT_DIR}/redis/redis.csr" \
  -CA "${CERT_DIR}/ca.crt" \
  -CAkey "${CERT_DIR}/ca.key" \
  -CAcreateserial \
  -out "${CERT_DIR}/redis/redis.crt" \
  -extfile "${CERT_DIR}/redis/ext.cnf"
cp "${CERT_DIR}/ca.crt" "${CERT_DIR}/redis/ca.crt"

chmod 600 "${CERT_DIR}/postgres/server.key" "${CERT_DIR}/redis/redis.key"
echo "TLS certs generated under ${CERT_DIR}"
