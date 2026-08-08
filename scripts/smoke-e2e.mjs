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
import { deflateSync } from "node:zlib";
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

// devnet 适配：官方水龙头有严格限制（每次 <=2 SOL 且按日/项目限额），
// SMOKE_FUND_FROM=admin 时改为由管理员钱包转账给临时钱包，避免依赖水龙头。
// SMOKE_FUND_SOL 控制每个临时钱包的 SOL 数（默认 5，与历史行为一致）。
const FUND_SOL = Number(process.env.SMOKE_FUND_SOL ?? 5);
const FUND_FROM = process.env.SMOKE_FUND_FROM ?? "faucet"; // "faucet" | "admin"
async function fund(pubkey) {
  if (FUND_FROM === "admin") {
    const tx = new Transaction();
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    tx.add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: pubkey,
        lamports: BigInt(Math.round(FUND_SOL * 1_000_000_000)),
      }),
    );
    tx.sign(admin);
    await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), "confirmed");
  } else {
    await conn.requestAirdrop(pubkey, FUND_SOL * 1_000_000_000);
  }
}
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
// 审计 H-xx：卖方不得等于买方（SelfDealing 拒绝），使用独立卖方钱包。
const seller = Keypair.generate();
await fund(wallet.publicKey);
await new Promise((r) => setTimeout(r, 1200));

const email = `smoke-${Date.now()}@example.com`;
const reg = await api(BASE, "/api/auth/register", null, "POST", {
  name: "Smoke",
  email,
  password: "secret123",
  wallet: wallet.publicKey.toBase58(),
});
results.register = true;

// 生成不同像素的合法 1x1 RGBA PNG：后端会用 sharp 重编码（去 EXIF/旋转），
// 尾部追加的垃圾字节会被丢弃，因此必须让"图像内容"本身随每次运行变化，
// 否则所有冒烟文件哈希相同，触发"该文件哈希已存证"409。
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function makePng(seed) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.from([0, seed % 256, (seed >> 8) % 256, (seed >> 16) % 256, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
// 审计 M-06：存证必须关联贸易订单（deal 必选、单据 PDA 按买方隔离）。
// 因此在存证前先创建并确认一个 PENDING 订单。
let attestTradeId = "";
if (USDC_MINT) {
  const usdc = new PublicKey(USDC_MINT);
  const buyerAta = (
    await getOrCreateAssociatedTokenAccount(conn, wallet, usdc, wallet.publicKey)
  ).address;
  await mintTo(conn, admin, usdc, buyerAta, admin.publicKey, 100_000_000);
  const pre = await api(TRADE, "/api/trades", reg.accessToken, "POST", {
    buyerWallet: wallet.publicKey.toBase58(),
    sellerWallet: seller.publicKey.toBase58(),
    // 金额区别于主线贸易流程，避免命中重复订单检测（返回空 transaction）。
    amount: "30000000",
    tenor: "30",
  });
  await api(
    TRADE,
    `/api/trades/${pre.tradeId}/confirm`,
    reg.accessToken,
    "POST",
    {
      buyerWallet: wallet.publicKey.toBase58(),
      sellerWallet: seller.publicKey.toBase58(),
      amount: "30000000",
      tenor: "30",
      txSignature: await signSend(pre.transaction, wallet),
    },
  );
  attestTradeId = pre.tradeId;
  console.log("attest trade created:", attestTradeId);
}

const png = makePng(Date.now());
const fd = new FormData();
fd.append("file", new Blob([png], { type: "image/png" }), "smoke.png");
if (attestTradeId) fd.append("tradeId", attestTradeId);
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
  tradeId: attestTradeId || undefined,
});
const sig = await signSend(built.transaction, wallet);
const confirmed = await api(
  BASE,
  `/api/files/${file.id}/attest/confirm`,
  reg.accessToken,
  "POST",
  { txSignature: sig, documentPda: built.documentPda, tradeId: attestTradeId || undefined },
);
results.attest = confirmed.ok === true;

if (USDC_MINT) {
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@supply-chain.io";
  const candidates = [
    process.env.ADMIN_PASSWORD,
    "Admin123!",
    "AdminChanged!1",
    "E2eAdmin2!",
  ].filter(Boolean);
  let adminLogin;
  let adminPassword = process.env.ADMIN_PASSWORD ?? "Admin123!";
  for (const password of candidates) {
    try {
      adminLogin = await api(BASE, "/api/auth/login", null, "POST", {
        email: adminEmail,
        password,
      });
      adminPassword = password;
      break;
    } catch {
      // 尝试下一个候选密码。
    }
  }
  if (!adminLogin) {
    throw new Error(`admin login failed for ${adminEmail}`);
  }
  let adminToken = adminLogin.accessToken;
  if (adminLogin.mustChangePassword) {
    await api(BASE, "/api/auth/change-password", adminToken, "POST", {
      currentPassword: adminPassword,
      newPassword: "AdminChanged!1",
    });
    adminPassword = "AdminChanged!1";
    const adminReLogin = await api(BASE, "/api/auth/login", null, "POST", {
      email: adminEmail,
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
    sellerWallet: seller.publicKey.toBase58(),
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
      sellerWallet: seller.publicKey.toBase58(),
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

  // 违约场景：第二笔订单，拨款后违约，验证 DEFAULTED（托管整笔回池）
  const defCreated = await api(TRADE, "/api/trades", reg.accessToken, "POST", {
    buyerWallet: wallet.publicKey.toBase58(),
    sellerWallet: seller.publicKey.toBase58(),
    amount: "10000000",
    tenor: "30",
  });
  await api(
    TRADE,
    `/api/trades/${defCreated.tradeId}/confirm`,
    reg.accessToken,
    "POST",
    {
      buyerWallet: wallet.publicKey.toBase58(),
      sellerWallet: seller.publicKey.toBase58(),
      amount: "10000000",
      tenor: "30",
      txSignature: await signSend(defCreated.transaction, wallet),
    },
  );
  const defFunded = await api(
    TRADE,
    `/api/trades/${defCreated.tradeId}/fund`,
    adminToken,
    "POST",
    { adminWallet: admin.publicKey.toBase58() },
  );
  await api(
    TRADE,
    `/api/trades/${defCreated.tradeId}/fund/confirm`,
    adminToken,
    "POST",
    { txSignature: await signSend(defFunded.transaction, admin) },
  );
  const defTx = await api(
    TRADE,
    `/api/trades/${defCreated.tradeId}/default`,
    adminToken,
    "POST",
    { adminWallet: admin.publicKey.toBase58() },
  );
  const defConfirm = await api(
    TRADE,
    `/api/trades/${defCreated.tradeId}/default/confirm`,
    adminToken,
    "POST",
    { txSignature: await signSend(defTx.transaction, admin) },
  );
  results.defaultScenario = defConfirm.status === "DEFAULTED";

  // D2 还款期违约保护：第三笔订单，拨款→放行（REPAYING）→账期未到即违约必须被拒绝
  // （补齐端到端冒烟清单 D2 的负向路径：DealNotExpired 安全门；正向路径需账期到期，
  // 由 Anchor 集成测试覆盖到期判定，本地/CI 无法真实等待 30 天账期）。
  const d2 = await api(TRADE, "/api/trades", reg.accessToken, "POST", {
    buyerWallet: wallet.publicKey.toBase58(),
    sellerWallet: seller.publicKey.toBase58(),
    amount: "8000000",
    tenor: "30",
  });
  await api(
    TRADE,
    `/api/trades/${d2.tradeId}/confirm`,
    reg.accessToken,
    "POST",
    {
      buyerWallet: wallet.publicKey.toBase58(),
      sellerWallet: seller.publicKey.toBase58(),
      amount: "8000000",
      tenor: "30",
      txSignature: await signSend(d2.transaction, wallet),
    },
  );
  const d2Funded = await api(
    TRADE,
    `/api/trades/${d2.tradeId}/fund`,
    adminToken,
    "POST",
    { adminWallet: admin.publicKey.toBase58() },
  );
  await api(
    TRADE,
    `/api/trades/${d2.tradeId}/fund/confirm`,
    adminToken,
    "POST",
    { txSignature: await signSend(d2Funded.transaction, admin) },
  );
  for (const target of ["2", "3", "4"]) {
    const builtAdv = await api(
      TRADE,
      `/api/trades/${d2.tradeId}/advance`,
      adminToken,
      "POST",
      { targetStatus: target, adminWallet: admin.publicKey.toBase58() },
    );
    await api(
      TRADE,
      `/api/trades/${d2.tradeId}/advance/confirm`,
      adminToken,
      "POST",
      {
        targetStatus: target,
        adminWallet: admin.publicKey.toBase58(),
        txSignature: await signSend(builtAdv.transaction, admin),
      },
    );
  }
  const d2Released = await api(
    TRADE,
    `/api/trades/${d2.tradeId}/release`,
    adminToken,
    "POST",
    { adminWallet: admin.publicKey.toBase58() },
  );
  const d2ReleaseConfirm = await api(
    TRADE,
    `/api/trades/${d2.tradeId}/release/confirm`,
    adminToken,
    "POST",
    { txSignature: await signSend(d2Released.transaction, admin) },
  );
  if (d2ReleaseConfirm.status !== "REPAYING") {
    throw new Error(`D2 前置失败：release 后应 REPAYING，实际 ${d2ReleaseConfirm.status}`);
  }
  // 负向断言：账期未到期，default 交易必须在链上被 DealNotExpired 拒绝。
  const d2DefaultTx = await api(
    TRADE,
    `/api/trades/${d2.tradeId}/default`,
    adminToken,
    "POST",
    { adminWallet: admin.publicKey.toBase58() },
  );
  let d2Rejected = false;
  try {
    await signSend(d2DefaultTx.transaction, admin);
  } catch (err) {
    d2Rejected = /DealNotExpired|6008|custom program error/.test(
      `${err?.message ?? ""} ${err?.transactionLogs?.join(" ") ?? ""}`,
    );
  }
  results.repaymentDefaultGuard = d2Rejected;
  if (!d2Rejected) {
    throw new Error("D2 负向断言失败：账期未到期的 REPAYING 订单违约应被拒绝");
  }
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
  const scI64 = (v) => {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(v));
    return b;
  };
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
        // 审计 N-04/I-05：完整 SHA-256（32 字节），与合约 sku_seed 一致。
        createHash("sha256").update(sku).digest(),
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

  // 程序数据账户：initialize_registry 校验 upgrade authority（审计 H-01/N-05）。
  const scProgramData = PublicKey.findProgramAddressSync(
    [SC_PROGRAM_ID.toBuffer()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  )[0];

  // 1) Registry：不存在则由 admin 初始化；已存在则校验 admin 一致。
  if (!(await conn.getAccountInfo(registryPda))) {
    await scSend(
      admin,
      [
        { pubkey: registryPda, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: scProgramData, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      Buffer.concat([scDisc("initialize_registry"), scI64(0)]), // 审计 H-06：测试用 0
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
  await fund(supplier.publicKey);
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
  await fund(stranger.publicKey);
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

  // 5) F5 撤销：管理员撤销供应商（账户关闭）→ 撤销其商品（标记失效）→ 撤销后注册被拒。
  // 补齐端到端冒烟清单 F5（此前仅 Anchor 集成测试覆盖，冒烟缺失）。
  if (await conn.getAccountInfo(supPda)) {
    await scSend(
      admin,
      [
        { pubkey: registryPda, isSigner: false, isWritable: false },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: supPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      Buffer.concat([scDisc("revoke_supplier"), supplier.publicKey.toBuffer()]),
    );
  }
  results.supplyChainRevokeSupplier = !(await conn.getAccountInfo(supPda));
  if (!results.supplyChainRevokeSupplier) {
    throw new Error("F5 revoke_supplier 后供应商账户未关闭");
  }

  // 撤销商品（product 账户标记 active=false；需 admin + owner 参数推导 PDA）。
  if (await conn.getAccountInfo(prodPda)) {
    await scSend(
      admin,
      [
        { pubkey: registryPda, isSigner: false, isWritable: false },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: supplier.publicKey, isSigner: false, isWritable: false }, // owner（用于推导 product PDA）
        { pubkey: prodPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      Buffer.concat([scDisc("revoke_product"), scStr(sku)]),
    );
  }
  const revokedProd = await conn.getAccountInfo(prodPda);
  if (!revokedProd) throw new Error("F5 revoke_product 后商品账户缺失");
  // Product 布局：disc(8) + owner(32) + sku(4 字节长度 + 内容) + units(8) + created_at(8) + active(1)
  const skuLen = revokedProd.data.readUInt32LE(8 + 32);
  const prodActive = revokedProd.data.readUInt8(8 + 32 + 4 + skuLen + 8 + 8);
  results.supplyChainRevokeProduct = prodActive === 0; // 审计 L-09：标记失效
  if (!results.supplyChainRevokeProduct) {
    throw new Error(`F5 revoke_product 后商品应 active=false，实际 ${prodActive}`);
  }

  // 撤销后：该供应商再注册新商品必须被拒绝（复用未授权路径的拒绝逻辑）。
  const revokedSku = `REVOKED-${Date.now()}`;
  const revokedProdPda = productPda(supplier.publicKey, revokedSku);
  try {
    await scSend(
      supplier,
      [
        { pubkey: registryPda, isSigner: false, isWritable: false },
        { pubkey: revokedProdPda, isSigner: false, isWritable: true },
        { pubkey: supplier.publicKey, isSigner: true, isWritable: true },
        { pubkey: supPda, isSigner: false, isWritable: false }, // 已关闭账户：传 0 地址/无效即拒绝
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      Buffer.concat([scDisc("register_product"), scStr(revokedSku), scU64(1)]),
    );
    results.supplyChainRejectRevoked = false; // 不应成功
  } catch {
    results.supplyChainRejectRevoked = true;
  }
}

console.log(JSON.stringify(results, null, 2));
if (Object.values(results).some((v) => v !== true)) process.exit(1);
