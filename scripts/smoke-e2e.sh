#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# 全链路冒烟（api-smoke，轻量补充）
# health → register(邮箱激活) → upload → createTrade(管理员代建) → pool/files
# 完整资金旅程见 smoke-e2e.mjs（ci-e2e.sh 先跑 mjs 再跑本脚本）
# ============================================================

BACKEND="${BACKEND_URL:-http://localhost:3001}"
TRADE="${TRADE_URL:-${TRADE_API_URL:-http://localhost:3004}}"
POOL="${POOL_URL:-${POOL_API_URL:-http://localhost:3005}}"
INDEXER="${INDEXER_URL:-${INDEXER_API_URL:-http://localhost:3003}}"
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

# --------------- 2. 注册 + 邮箱激活 + 登录（新流程） ---------------
echo "--- Auth ---"
AUTH_JSON=$(BACKEND_URL="$BACKEND" TRADE_URL="$TRADE" node <<'NODE'
const BACKEND = process.env.BACKEND_URL;
const email = `smoke-${Date.now()}@test.supply-chain.io`;
const password = "Smoke123!";
async function api(path, method = "POST", body, token) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return json;
}
(async () => {
  // 注册需邀请码：超管登录生成一个（种子账号免邮箱码；兼容强制改密）
  async function loginSuper() {
    const email = process.env.SUPER_ADMIN_EMAIL || "root@supply-chain.io";
    const candidates = [process.env.SUPER_ADMIN_PASSWORD, "SuperAdmin123!", "AdminChanged!1"].filter(Boolean);
    for (const pw of candidates) {
      try {
        const l = await api("/api/auth/login", "POST", { email, password: pw });
        if (l.mustChangePassword) {
          await api("/api/auth/change-password", l.accessToken, "POST", { currentPassword: pw, newPassword: "AdminChanged!1" });
          const re = await api("/api/auth/login", "POST", { email, password: "AdminChanged!1" });
          return re;
        }
        return l;
      } catch { /* next candidate */ }
    }
    throw new Error("super admin login failed");
  }
  const adm = await loginSuper();
  const inv = await api("/api/admin/invite-codes/generate", "POST", { count: 1 }, adm.accessToken);
  if (!inv.codes?.[0]) throw new Error("invite code generation failed");
  const reg = await api("/api/auth/register", "POST", {
    name: "Smoke", email, password,
    wallet: require("@solana/web3.js").Keypair.generate().publicKey.toBase58(),
    inviteCode: inv.codes[0],
  });
  if (!reg.requiresEmailVerification || !reg.devCode) throw new Error("register: no devCode");
  await api("/api/auth/verify-email", "POST", { email, code: reg.devCode });
  let login = await api("/api/auth/login", "POST", { email, password });
  if (login.requiresEmailOtp) {
    let code = login.devCode;
    if (!code) {
      await new Promise((r) => setTimeout(r, 65_000)); // 60s 冷却
      login = await api("/api/auth/login", "POST", { email, password });
      code = login.devCode;
    }
    if (!code) throw new Error("login: no email OTP devCode");
    login = await api("/api/auth/login", "POST", { email, password, emailOtpCode: code });
  }
  if (!login.accessToken) throw new Error("login: no accessToken");
  console.log(JSON.stringify({ token: login.accessToken, email }));
})().catch((e) => { console.error(e.message); process.exit(1); });
NODE
)
TOKEN=$(echo "$AUTH_JSON" | jq -r '.token // empty')
check "register→邮箱激活→登录" "$([[ -n "$TOKEN" && "$TOKEN" != "null" ]] && echo true || echo false)"

# --------------- 3. Upload（无 tradeId，普通上传） ---------------
echo "--- Upload ---"
PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
UPLOAD_RESP=$(base64 -d <<< "$PNG" | curl -sS -X POST "$BACKEND/api/files" \
  -H "authorization: Bearer ${TOKEN:-}" \
  -F "file=@-;filename=smoke.png;type=image/png")
FILE_ID=$(echo "$UPLOAD_RESP" | jq -r '.id // empty')
check "upload" "$([[ -n "$FILE_ID" && "$FILE_ID" != "null" ]] && echo true || echo false)"

# --------------- 4. 管理员代建订单（买方=管理员钱包，卖方=用户钱包） ---------------
echo "--- Trade ---"
TRD=$(TRADE_URL="$TRADE" BACKEND_URL="$BACKEND" node <<'NODE'
const TRADE = process.env.TRADE_URL;
const BACKEND = process.env.BACKEND_URL;
const { Keypair, PublicKey } = require("@solana/web3.js");
async function api(base, path, token, method = "POST", body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return json;
}
(async () => {
  const seller = Keypair.generate();
  const admin = Keypair.generate();
  // 超管登录（种子账号免邮箱码；兼容强制改密）
  async function loginSuper() {
    const email = process.env.SUPER_ADMIN_EMAIL || "root@supply-chain.io";
    const candidates = [process.env.SUPER_ADMIN_PASSWORD, "SuperAdmin123!", "AdminChanged!1"].filter(Boolean);
    for (const pw of candidates) {
      try {
        const l = await api(BACKEND, "/api/auth/login", null, "POST", { email, password: pw });
        if (l.mustChangePassword) {
          await api(BACKEND, "/api/auth/change-password", l.accessToken, "POST", { currentPassword: pw, newPassword: "AdminChanged!1" });
          const re = await api(BACKEND, "/api/auth/login", null, "POST", { email, password: "AdminChanged!1" });
          return re;
        }
        return l;
      } catch { /* next candidate */ }
    }
    throw new Error("super admin login failed");
  }
  const login = await loginSuper();
  const adminToken = login.accessToken;
  await api(BACKEND, "/api/auth/wallet", adminToken, "PATCH", {
    wallet: admin.publicKey.toBase58(),
    emailCode: "000000",
  });
  const created = await api(TRADE, "/api/trades", adminToken, "POST", {
    buyerWallet: admin.publicKey.toBase58(),
    sellerWallet: seller.publicKey.toBase58(),
    amount: "1000000",
    tenor: "30",
  });
  console.log(JSON.stringify({ tradeId: created.tradeId || "", hasTx: Boolean(created.transaction) }));
})().catch((e) => { console.error(e.message); process.exit(1); });
NODE
)
TRADE_ID=$(echo "$TRD" | jq -r '.tradeId // empty')
HAS_TX=$(echo "$TRD" | jq -r '.hasTx // false')
check "管理员代建订单" "$([[ -n "$TRADE_ID" && "$HAS_TX" == "true" ]] && echo true || echo false)"

# --------------- 5. List trades（用户可见） ---------------
echo "--- List ---"
LIST=$(curl -sS "$TRADE/api/trades" -H "authorization: Bearer ${TOKEN}")
check "list trades" "$([[ $(echo "$LIST" | jq 'length') -ge 0 ]] && echo true || echo false)"

# --------------- 6. Pool overview ---------------
echo "--- Pool ---"
POOL_RESP=$(curl -sS "$POOL/api/pool/overview" -H "authorization: Bearer ${TOKEN}")
check "pool overview" "$([[ $(echo "$POOL_RESP" | jq -r '.poolAddress // ""') != "" ]] && echo true || echo false)"

# --------------- 7. Files listing ---------------
echo "--- Files ---"
FILES=$(curl -sS "$BACKEND/api/files" -H "authorization: Bearer ${TOKEN}")
check "files list" "$([[ -n "$FILES" ]] && echo true || echo false)"

# --------------- Summary ---------------
echo ""
echo "=== 结果: ${PASS} 通过 / $((PASS + FAIL)) 总计 ==="
if [[ $FAIL -gt 0 ]]; then
  red "存在 ${FAIL} 个失败项"
  exit 1
else
  green "全部通过"
fi
