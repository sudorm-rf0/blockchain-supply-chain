// 全链路冒烟：注册 → 上传 → 存证上链 → （若配置 USDC_MINT）订单全流程。
// 运行：node scripts/smoke-e2e.mjs
// 可选：USDC_MINT=<mint> LP_MINT=<mint> 启用订单资金流（需先跑 init-localnet.mjs）。
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

const RPC = process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
const BASE = process.env.BACKEND_URL ?? "http://localhost:3001";
const TRADE = process.env.TRADE_URL ?? "http://localhost:3004";
const USDC_MINT = process.env.USDC_MINT;

const conn = new Connection(RPC, "confirmed");
const adminSecret = JSON.parse(
  readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"),
);
const admin = Keypair.fromSecretKey(Uint8Array.from(adminSecret));
const results = {};

async function api(base, path, token, method = "GET", body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function signSend(transactionB64, signer) {
  const tx = Transaction.from(Buffer.from(transactionB64, "base64"));
  tx.partialSign(signer);
  const sig = await conn.sendRawTransaction(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  );
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

const wallet = Keypair.generate();
await conn.requestAirdrop(wallet.publicKey, 5_000_000_000);
await new Promise((r) => setTimeout(r, 1200));

const email = `smoke-${Date.now()}@example.com`;
const reg = await api(BASE, "/api/auth/register", null, "POST", {
  name: "Smoke",
  email,
  password: "secret123",
  wallet: wallet.publicKey.toBase58(),
});
results.register = true;

const png = Buffer.concat([
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
  Buffer.from(String(Date.now())),
]);
const fd = new FormData();
fd.append("file", new Blob([png], { type: "image/png" }), "smoke.png");
const upRes = await fetch(`${BASE}/api/files`, {
  method: "POST",
  headers: { authorization: `Bearer ${reg.accessToken}` },
  body: fd,
});
if (!upRes.ok) throw new Error(`POST /api/files -> ${upRes.status}: ${await upRes.text()}`);
const file = await upRes.json();
results.upload = true;

const built = await api(BASE, `/api/files/${file.id}/attest`, reg.accessToken, "POST", {
  walletAddress: wallet.publicKey.toBase58(),
});
const sig = await signSend(built.transaction, wallet);
const confirmed = await api(
  BASE,
  `/api/files/${file.id}/attest/confirm`,
  reg.accessToken,
  "POST",
  { txSignature: sig, documentPda: built.documentPda },
);
results.attest = confirmed.ok === true;

if (USDC_MINT) {
  const adminLogin = await api(BASE, "/api/auth/login", null, "POST", {
      email: process.env.ADMIN_EMAIL ?? "admin@supply-chain.io",
      password: process.env.ADMIN_PASSWORD ?? "Admin123!",
  });
  let adminPassword = process.env.ADMIN_PASSWORD ?? "Admin123!";
  let adminToken = adminLogin.accessToken;
  if (adminLogin.mustChangePassword) {
    await api(BASE, "/api/auth/change-password", adminToken, "POST", {
      currentPassword: adminPassword,
      newPassword: "AdminChanged!1",
    });
    adminPassword = "AdminChanged!1";
    const adminReLogin = await api(BASE, "/api/auth/login", null, "POST", {
      email: process.env.ADMIN_EMAIL ?? "admin@supply-chain.io",
      password: adminPassword,
    });
    adminToken = adminReLogin.accessToken;
  }
  const usdc = new PublicKey(USDC_MINT);
  const buyerAta = (
    await getOrCreateAssociatedTokenAccount(conn, wallet, usdc, wallet.publicKey)
  ).address;
  await mintTo(conn, admin, usdc, buyerAta, admin.publicKey, 100_000_000);

  const created = await api(TRADE, "/api/trades", reg.accessToken, "POST", {
    buyerWallet: wallet.publicKey.toBase58(),
    sellerWallet: wallet.publicKey.toBase58(),
    amount: "50000000",
    tenor: "30",
  });
  await api(
    TRADE,
    `/api/trades/${created.tradeId}/confirm`,
    reg.accessToken,
    "POST",
    {
      buyerWallet: wallet.publicKey.toBase58(),
      sellerWallet: wallet.publicKey.toBase58(),
      amount: "50000000",
      tenor: "30",
      txSignature: await signSend(created.transaction, wallet),
    },
  );
  const funded = await api(
    TRADE,
    `/api/trades/${created.tradeId}/fund`,
    adminToken,
    "POST",
    { adminWallet: admin.publicKey.toBase58() },
  );
  await api(
    TRADE,
    `/api/trades/${created.tradeId}/fund/confirm`,
    adminToken,
    "POST",
    { txSignature: await signSend(funded.transaction, admin) },
  );
  for (const target of ["2", "3", "4"]) {
    const builtAdv = await api(
      TRADE,
      `/api/trades/${created.tradeId}/advance`,
      adminToken,
      "POST",
      { targetStatus: target, adminWallet: admin.publicKey.toBase58() },
    );
    await api(
      TRADE,
      `/api/trades/${created.tradeId}/advance/confirm`,
      adminToken,
      "POST",
      {
        targetStatus: target,
        adminWallet: admin.publicKey.toBase58(),
        txSignature: await signSend(builtAdv.transaction, admin),
      },
    );
  }
  const released = await api(
    TRADE,
    `/api/trades/${created.tradeId}/release`,
    adminToken,
    "POST",
    { adminWallet: admin.publicKey.toBase58() },
  );
  await api(
    TRADE,
    `/api/trades/${created.tradeId}/release/confirm`,
    adminToken,
    "POST",
    { txSignature: await signSend(released.transaction, admin) },
  );
  const repay = await api(TRADE, `/api/trades/${created.tradeId}/repay`, reg.accessToken, "POST");
  const repayRes = await api(
    TRADE,
    `/api/trades/${created.tradeId}/repay/confirm`,
    reg.accessToken,
    "POST",
    { txSignature: await signSend(repay.transaction, wallet) },
  );
  results.tradeLifecycle = repayRes.status === "SETTLED";
}

console.log(JSON.stringify(results, null, 2));
if (Object.values(results).some((v) => v !== true)) process.exit(1);
