#!/usr/bin/env bash
# 检查 Solana RPC 连通性。
# 用法：bash scripts/check-rpc.sh [url]  或  SOLANA_RPC_URL=<url> bash scripts/check-rpc.sh
set -euo pipefail

URL="${1:-${SOLANA_RPC_URL:-}}"
if [[ -z "${URL}" ]]; then
  echo "usage: bash scripts/check-rpc.sh <rpc-url>" >&2
  exit 2
fi

echo "== RPC: ${URL}"
for i in 1 2 3; do
  if curl -sS --max-time 15 -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "${URL}" \
    | grep -q '"result":"ok"'; then
    curl -sS --max-time 15 -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":2,"method":"getVersion"}' "${URL}"
    echo
    echo "rpc healthy"
    exit 0
  fi
  sleep 2
done
echo "rpc check failed after 3 attempts" >&2
exit 1
