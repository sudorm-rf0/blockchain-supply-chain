#!/usr/bin/env bash
# 检查 Solana RPC 连通性。
# 用法：bash scripts/check-rpc.sh [url]  或  SOLANA_RPC_URL=<url> bash scripts/check-rpc.sh
# 可选：QUIET=1 不打印 RPC URL，适合 CI 中避免 Secret 出现在日志。
# 可选：RPC_CHECK_ALLOW_FAIL=1 时探测失败仅告警不退出（用于不依赖外网 RPC 的 CI job）。
set -euo pipefail

URL="${1:-${SOLANA_RPC_URL:-}}"
QUIET="${QUIET:-0}"
RPC_CHECK_ALLOW_FAIL="${RPC_CHECK_ALLOW_FAIL:-0}"
if [[ -z "${URL}" ]]; then
  echo "usage: bash scripts/check-rpc.sh <rpc-url>" >&2
  exit 2
fi

if [[ "${QUIET}" != "1" ]]; then
  echo "== RPC: ${URL}"
fi
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
if [[ "${RPC_CHECK_ALLOW_FAIL}" == "1" ]]; then
  echo "rpc check failed after 3 attempts (RPC_CHECK_ALLOW_FAIL=1, continuing)" >&2
  exit 0
fi
echo "rpc check failed after 3 attempts" >&2
exit 1
