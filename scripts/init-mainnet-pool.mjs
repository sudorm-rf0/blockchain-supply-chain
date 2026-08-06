// 主网资金池初始化 + 真实 USDC 存款（不可逆，涉及真实资金！）
// 用法：node scripts/init-mainnet-pool.mjs --yes [--dry-run] [--skip-deposit]
// 环境变量：
//   SOLANA_RPC_URL       主网 RPC（拒绝 localhost/devnet）
//   TRADE_FINANCE_PROGRAM_ID  主网 Program ID（deploy-mainnet.sh 输出）
//   USDC_MINT            默认主网 USDC EPjFWdd5...
//   LP_MINT              必须设置（mint authority 已交多签）
//   DEPOSIT_USDC         存款金额（单位 USDC，默认 1000）
//   SOLANA_KEYPAIR_PATH  主网部署钱包（冷钱包）
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

const args = process.argv.slice(2);
const YES = args.includes("--yes");
const DRY_RUN = args.includes("--dry-run");
const SKIP_DEPOSIT = args.includes("--skip-deposit");
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const RPC = process.env.SOLANA_RPC_URL ?? "";
const PROGRAM_ID = process.env.TRADE_FINANCE_PROGRAM_ID;
const USDC_MINT = process.env.USDC_MINT ?? MAINNET_USDC;
const LP_MINT = process.env.LP_MINT;
const DEPOSIT_USDC_USD = Number(process.env.DEPOSIT_USDC ?? 1000);
const keypairPath = process.env.SOLANA_KEYPAIR_PATH ?? `${homedir()}/.config/solana/id.json`;

// ---------- 硬护栏 ----------
if (!RPC || /localhost|127\.0\.0\.1|devnet/i.test(RPC)) {
  console.error("❌ SOLANA_RPC_URL 必须是主网 RPC（拒绝 localhost/devnet）");
  process.exit(1);
}
if (!PROGRAM_ID) {
  console.error("❌ 必须设置 TRADE_FINANCE_PROGRAM_ID（deploy-mainnet.sh 输出的新 ID）");
  process.exit(1);
}
if (!LP_MINT) {
  console.error("❌ 必须设置 LP_MINT（mint authority 已交多签）");
  process.exit(1);
}
if (USDC_MINT !== MAINNET_USDC) {
  console.warn(`⚠️ USDC_MINT 不是主网 USDC（${MAINNET_USDC}）：${USDC_MINT}`);
  if (!YES) { console.error("❌ 非标准 USDC Mint，需要 --yes 确认"); process.exit(1); }
}
if (DEPOSIT_USDC_USD <= 0 || !Number.isFinite(DEPOSIT_USDC_USD)) {
  console.error("❌ DEPOSIT_USDC 必须为正数（单位 USDC）");
  process.exit(1);
}
if (!SKIP_DEPOSIT && !YES) {
  console.error("❌ 存款涉及真实资金，必须传 --yes 确认");
  process.exit(1);
}

const conn = new Connection(RPC, "confirmed");
const secret = JSON.parse(readFileSync(keypairPath, "utf8"));
const admin = Keypair.fromSecretKey(Uint8Array.from(secret));
const programId = new PublicKey(PROGRAM_ID);
const usdcMint = new PublicKey(USDC_MINT);
const lpMint = new PublicKey(LP_MINT);

const poolState = PublicKey.findProgramAddressSync(
  [Buffer.from("trade_finance"), Buffer.from("pool")],
  programId,
)[0];
const poolAuthority = PublicKey.findProgramAddressSync(
  [Buffer.from("trade_finance"), Buffer.from("pool_usdc")],
  programId,
)[0];

const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const latest = () => conn.getLatestBlockhash("confirmed");
const depositLamports = BigInt(Math.round(DEPOSIT_USDC_USD * 1_000_000));

console.log(`==> 主网池初始化计划`);
console.log(`  RPC:        ${RPC}`);
console.log(`  钱包:       ${admin.publicKey.toBase58()}`);
console.log(`  programId:  ${programId.toBase58()}`);
console.log(`  USDC:       ${usdcMint.toBase58()}`);
console.log(`  LP:         ${lpMint.toBase58()}`);
console.log(`  存款:       ${DEPOSIT_USDC_USD} USDC${SKIP_DEPOSIT ? "（跳过）" : ""}`);
console.log(`  Pool PDA:   ${poolState.toBase58()}`);

const poolExists = Boolean(await conn.getAccountInfo(poolState));
console.log(`  Pool 已初始化: ${poolExists}`);

// 只读推导 ATA（dry-run 安全，不产生任何写操作）
const adminAta = await getAssociatedTokenAddress(usdcMint, admin.publicKey);
const poolTokenAccount = await getAssociatedTokenAddress(usdcMint, poolAuthority, true);

let adminBalance = 0;
if (await conn.getAccountInfo(adminAta)) {
  adminBalance = (await conn.getTokenAccountBalance(adminAta)).value.uiAmount ?? 0;
}
console.log(`  管理员 USDC 余额: ${adminBalance}`);
if (!SKIP_DEPOSIT && !DRY_RUN && adminBalance < DEPOSIT_USDC_USD) {
  console.error(`❌ 管理员 USDC 余额不足：需要 ${DEPOSIT_USDC_USD}，现有 ${adminBalance}`);
  process.exit(1);
}

if (DRY_RUN) {
  console.log("\n==> [dry-run] 未执行任何交易");
  process.exit(0);
}

// 真实模式：存款需要管理员 ATA 已存在（有真实 USDC）
if (!SKIP_DEPOSIT && !(await conn.getAccountInfo(adminAta))) {
  console.error("❌ 管理员没有 USDC ATA，请先转入主网 USDC 以创建该账户");
  process.exit(1);
}

// ---------- 1) initialize_pool（幂等） ----------
if (!poolExists) {
  if (!YES) { console.error("❌ 初始化 Pool 需要 --yes"); process.exit(1); }
  const tx = new Transaction();
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await latest()).blockhash;
  tx.add(new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: lpMint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.concat([disc("initialize_pool"), admin.publicKey.toBuffer()]),
  }));
  tx.sign(admin);
  await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), "confirmed");
  console.log("✅ pool initialized");
} else {
  console.log("pool 已存在，跳过 initialize_pool");
}

// ---------- 2) deposit_pool（真实 USDC） ----------
if (!SKIP_DEPOSIT) {
  const poolVault = (
    await getOrCreateAssociatedTokenAccount(conn, admin, usdcMint, poolAuthority, true)
  ).address;
  const tx = new Transaction();
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await latest()).blockhash;
  tx.add(new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: adminAta, isSigner: false, isWritable: true },
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: poolVault, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: lpMint, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.concat([disc("deposit_pool"), u64(depositLamports)]),
  }));
  tx.sign(admin);
  await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), "confirmed");
  console.log(`✅ 已存入 ${DEPOSIT_USDC_USD} USDC`);
}

console.log(`POOL=${poolState.toBase58()}`);
console.log(`USDC_MINT=${usdcMint.toBase58()}`);
console.log(`LP_MINT=${lpMint.toBase58()}`);
console.log(`ADMIN=${admin.publicKey.toBase58()}`);
