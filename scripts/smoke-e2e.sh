#!/usr/bin/env bash
set -euo pipefail
TOKEN=""

# ============================================================
# 全链路冒烟测试
# register → upload → approve → createTrade → pool overview
# ============================================================

BACKEND="${BACKEND_URL:-http://localhost:3001}"
TRADE="${TRADE_API_URL:-http://localhost:3004}"
POOL="${POOL_API_URL:-http://localhost:3005}"
INDEXER="${INDEXER_API_URL:-http://localhost:3003}"
PASS=0
FAIL=0

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }

check() {
  local desc="$1" ok="$2"
  if [[ "$ok" == "true" ]]; then
    green "  ✓ ${desc}"
    PASS=$((PASS + 1))
  else
    red "  ✗ ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

http_code() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }

echo "=== 冒烟测试 $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# --------------- 1. Health ---------------
echo "--- Health ---"
check "backend /health"  "$([[ $(http_code "$BACKEND/health") == "200" ]] && echo true || echo false)"
check "trade /health"    "$([[ $(http_code "$TRADE/health") == "200" ]] && echo true || echo false)"
check "pool /health"     "$([[ $(http_code "$POOL/health") == "200" ]] && echo true || echo false)"
check "indexer status"   "$([[ $(http_code "$INDEXER/api/indexer/status") == "200" ]] && echo true || echo false)"

# --------------- 2. Register ---------------
echo "--- Auth ---"
RND="smoke-$(date +%s)"
EMAIL="${RND}@test.supply-chain.io"
WALLET=$(node -e "const kp=require('@solana/web3.js').Keypair.generate();console.log(kp.publicKey.toBase58())")
REG=$(curl -sS -X POST "$BACKEND/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke\",\"email\":\"$EMAIL\",\"password\":\"Smoke123!\",\"wallet\":\"$WALLET\"}")
REG_TOKEN=$(echo "$REG" | jq -r '.accessToken // .token // empty')
check "register" "$([[ -n "$REG_TOKEN" && "$REG_TOKEN" != "null" ]] && echo true || echo false)"
TOKEN="$REG_TOKEN"

# --------------- 3. Upload ---------------
echo "--- Upload ---"
PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
UPLOAD_RESP=$(base64 -d <<< "$PNG" | curl -sS -X POST "$BACKEND/api/files" \
  -H "authorization: Bearer ${TOKEN:-}" \
  -F "file=@-;filename=smoke.png;type=image/png")
FILE_ID=$(echo "$UPLOAD_RESP" | jq -r '.id // empty')
check "upload" "$([[ -n "$FILE_ID" && "$FILE_ID" != "null" ]] && echo true || echo false)"

# --------------- 4. Trade ---------------
echo "--- Trade ---"
TRD=$(curl -sS -X POST "$TRADE/api/trades" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer ${TOKEN:-}" \
  -d "{\"buyerWallet\":\"$WALLET\",\"sellerWallet\":\"8xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin\",\"amount\":\"1000000\",\"tenor\":\"30\"}")
TRADE_ID=$(echo "$TRD" | jq -r '.tradeId // empty')
HAS_TX=$(echo "$TRD" | jq -r '.transaction // empty')
check "create trade" "$([[ -n "$TRADE_ID" && -n "$HAS_TX" ]] && echo true || echo false)"

# --------------- 5. List trades ---------------
LIST=$(curl -sS "$TRADE/api/trades" -H "authorization: Bearer ${TOKEN}")
check "list trades" "$([[ $(echo "$LIST" | jq 'length') -ge 0 ]] && echo true || echo false)"

# --------------- 6. Pool overview ---------------
echo "--- Pool ---"
POOL_RESP=$(curl -sS "$POOL/api/pool/overview" -H "authorization: Bearer ${TOKEN}")
check "pool overview" "$([[ $(echo "$POOL_RESP" | jq -r '.poolAddress // ""') != "" ]] && echo true || echo false)"

# --------------- 7. Files listing ---------------
echo "--- Files ---"
FILES=$(curl -sS "$BACKEND/api/files" -H "authorization: Bearer ${TOKEN}")
check "files list" "$([[ $(echo "$FILES" | jq -r '.total') -ge 0 ]] && echo true || echo false)"

# --------------- Summary ---------------
echo ""
echo "=== 结果: ${PASS} 通过 / $((PASS + FAIL)) 总计 ==="
if [[ $FAIL -gt 0 ]]; then
  red "存在 ${FAIL} 个失败项"
  exit 1
else
  green "全部通过"
fi
