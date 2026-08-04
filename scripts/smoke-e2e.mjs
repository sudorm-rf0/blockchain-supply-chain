// 全链路冒烟：注册 → 上传 → 存证上链 → （若配置 USDC_MINT）订单全流程。
// 运行：node scripts/smoke-e2e.mjs
// 可选：USDC_MINT=<mint> LP_MINT=<mint> 启用订单资金流（需先跑 init-localnet.mjs）。
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

const RPC = process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
const BASE = process.env.BACKEND_URL ?? "http://localhost:3001";
const TRADE = process.env.TRADE_URL ?? "http://localhost:3004";
const USDC_MINT = process.env.USDC_MINT;

const conn = new Connection(RPC, "confirmed");
const keypairPath =
  process.env.SOLANA_KEYPAIR_PATH ??
  `${homedir()}/.config/solana/id.json`;
const adminSecret = JSON.parse(readFileSync(keypairPath, "utf8"));
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

// ---- supply-chain 权限化注册冒烟（默认启用；SKIP_SUPPLY_CHAIN=1 跳过）----
if (!process.env.SKIP_SUPPLY_CHAIN) {
  const SC_PROGRAM_ID = new PublicKey(
    process.env.SUPPLY_CHAIN_PROGRAM_ID ??
      "Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk",
  );
  if (!(await conn.getAccountInfo(SC_PROGRAM_ID))) {
    throw new Error(
      `supply_chain program not deployed at ${SC_PROGRAM_ID.toBase58()}; ` +
        "deploy it first or set SKIP_SUPPLY_CHAIN=1",
    );
  }
  const scDisc = (name) =>
    createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
  const scU64 = (v) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(v));
    return b;
  };
  const scStr = (str) => {
    const b = Buffer.from(str, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(b.length);
    return Buffer.concat([len, b]);
  };
  const registryPda = PublicKey.findProgramAddressSync(
    [Buffer.from("supply_chain"), Buffer.from("registry")],
    SC_PROGRAM_ID,
  )[0];
  const supplierPda = (key) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("supply_chain"), Buffer.from("supplier"), key.toBuffer()],
      SC_PROGRAM_ID,
    )[0];
  const productPda = (owner, sku) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("supply_chain"),
        Buffer.from("product"),
        owner.toBuffer(),
        createHash("sha256").update(sku).digest().subarray(0, 8),
      ],
      SC_PROGRAM_ID,
    )[0];

  async function scSend(signer, keys, data) {
    const tx = new Transaction();
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    tx.add(new TransactionInstruction({ keys, programId: SC_PROGRAM_ID, data }));
    tx.sign(signer);
    await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), "confirmed");
  }

  // 1) Registry：不存在则由 admin 初始化；已存在则校验 admin 一致。
  if (!(await conn.getAccountInfo(registryPda))) {
    await scSend(
      admin,
      [
        { pubkey: registryPda, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      scDisc("initialize_registry"),
    );
  }
  const regInfo = await conn.getAccountInfo(registryPda);
  if (!regInfo) throw new Error("supply_chain registry missing after init");
  const regAdmin = new PublicKey(regInfo.data.subarray(8, 40));
  if (regAdmin.toBase58() !== admin.publicKey.toBase58()) {
    throw new Error(
      `supply_chain registry admin mismatch: ${regAdmin.toBase58()} != ${admin.publicKey.toBase58()}`,
    );
  }

  // 2) 授权一个临时供应商（幂等）。
  const supplier = Keypair.generate();
  await conn.requestAirdrop(supplier.publicKey, 5_000_000_000);
  await new Promise((r) => setTimeout(r, 1200));
  const supPda = supplierPda(supplier.publicKey);
  if (!(await conn.getAccountInfo(supPda))) {
    await scSend(
      admin,
      [
        { pubkey: registryPda, isSigner: false, isWritable: false },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: supPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      Buffer.concat([scDisc("authorize_supplier"), supplier.publicKey.toBuffer()]),
    );
  }

  // 3) 供应商注册商品并校验链上账户。
  const sku = `SMOKE-${Date.now()}`;
  const units = 100;
  const prodPda = productPda(supplier.publicKey, sku);
  await scSend(
    supplier,
    [
      { pubkey: registryPda, isSigner: false, isWritable: false },
      { pubkey: prodPda, isSigner: false, isWritable: true },
      { pubkey: supplier.publicKey, isSigner: true, isWritable: true },
      { pubkey: supPda, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    Buffer.concat([scDisc("register_product"), scStr(sku), scU64(units)]),
  );
  const prodInfo = await conn.getAccountInfo(prodPda);
  if (!prodInfo) throw new Error("supply_chain product account missing after register");
  const prodOwner = new PublicKey(prodInfo.data.subarray(8, 40));
  if (prodOwner.toBase58() !== supplier.publicKey.toBase58()) {
    throw new Error(`supply_chain product owner mismatch: ${prodOwner.toBase58()}`);
  }
  results.supplyChainRegister = true;

  // 4) 负面用例：未授权钱包注册必须被拒绝。
  const stranger = Keypair.generate();
  await conn.requestAirdrop(stranger.publicKey, 5_000_000_000);
  await new Promise((r) => setTimeout(r, 1200));
  const badSku = `BLOCKED-${Date.now()}`;
  const badProd = productPda(stranger.publicKey, badSku);
  try {
    await scSend(
      stranger,
      [
        { pubkey: registryPda, isSigner: false, isWritable: false },
        { pubkey: badProd, isSigner: false, isWritable: true },
        { pubkey: stranger.publicKey, isSigner: true, isWritable: true },
        { pubkey: SC_PROGRAM_ID, isSigner: false, isWritable: false }, // supplier: None（Anchor 约定：key == program_id 视为 None）
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      Buffer.concat([scDisc("register_product"), scStr(badSku), scU64(1)]),
    );
    results.supplyChainRejectUnauthorized = false; // 不应成功
  } catch {
    results.supplyChainRejectUnauthorized = true;
  }
}

console.log(JSON.stringify(results, null, 2));
if (Object.values(results).some((v) => v !== true)) process.exit(1);
