#!/usr/bin/env bash
set -euo pipefail

DURATION="${DURATION:-10}"
CONCURRENCY="${CONCURRENCY:-50}"
TOKEN=""

run() {
  local name="$1"
  shift
  echo "=== ${name} ==="
  autocannon -c "${CONCURRENCY}" -d "${DURATION}" -j "$@" \
    | jq '{requests, non2xx, errors, latency: {avg: .latency.average, p99: .latency.p99}, throughput: {avg: .throughput.average}, statusCodeStats}'
  echo ""
}

if [[ -n "${LOGIN_EMAIL:-}" && -n "${LOGIN_PASSWORD:-}" ]]; then
  TOKEN=$(curl -sS -X POST "${BACKEND_URL:-http://localhost:3001}/api/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${LOGIN_EMAIL}\",\"password\":\"${LOGIN_PASSWORD}\"}" | jq -r '.token')
  echo "token acquired: ${#TOKEN} chars"
fi

AUTH=()
if [[ -n "${TOKEN}" ]]; then
  AUTH=(-H "authorization: Bearer ${TOKEN}")
fi

run "health (backend 3001)" http://localhost:3001/health
run "indexer status (3003)" http://localhost:3003/api/indexer/status
run "pool overview (3005)" http://localhost:3005/api/pool/overview

if [[ -n "${TOKEN}" ]]; then
  run "files list (backend)" -H "authorization: Bearer ${TOKEN}" http://localhost:3001/api/files
  run "trade list (3004)" -H "authorization: Bearer ${TOKEN}" http://localhost:3004/api/trades
fi
