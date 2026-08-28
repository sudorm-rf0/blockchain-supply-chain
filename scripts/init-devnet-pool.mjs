// devnet 新版合约池初始化（测试用）
// 用法: node scripts/init-devnet-pool.mjs
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createMint, mintTo, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const USED_USDC_MINT = process.env.USDC_MINT ? new PublicKey(process.env.USDC_MINT) : null;
const USED_LP_MINT = process.env.LP_MINT ? new PublicKey(process.env.LP_MINT) : null;
const PROGRAM_ID = process.env.TRADE_FINANCE_PROGRAM_ID ?? "8GSbCjUhgpvgQ35tx7wqFZCznP5HW2mn1jUYcGahC4tq";
const KEYPAIR_PATH = process.env.SOLANA_KEYPAIR_PATH ?? "packages/contracts/target/deploy/devnet-new/deployer-keypair.json";
const TEST_USDC_DEPOSIT = BigInt(Number(process.env.DEPOSIT_USDC ?? 2000) * 1_000_000);

const conn = new Connection(RPC, "confirmed");
const secret = JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"));
const admin = Keypair.fromSecretKey(Uint8Array.from(secret));
const programId = new PublicKey(PROGRAM_ID);

const [poolState] = PublicKey.findProgramAddressSync([Buffer.from("trade_finance"), Buffer.from("trade_pool")], programId);
const [poolAuthority] = PublicKey.findProgramAddressSync([Buffer.from("trade_finance"), Buffer.from("trade_pool_usdc")], programId);
const programData = PublicKey.findProgramAddressSync([programId.toBuffer()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"))[0];
const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const latest = () => conn.getLatestBlockhash("confirmed");

console.log("RPC:", RPC);
console.log("部署钱包:", admin.publicKey.toBase58());
console.log("programId:", programId.toBase58());
console.log("poolState:", poolState.toBase58());
console.log("poolAuthority:", poolAuthority.toBase58());

// 1) 创建测试 USDC mint（authority=admin；已提供则复用）
console.log("\n==> 测试 USDC mint");
const testUsdc = USED_USDC_MINT ?? (await createMint(conn, admin, admin.publicKey, null, 6));
console.log("TEST_USDC:", testUsdc.toBase58());

// 2) 创建 LP mint（authority=poolAuthority，无 freeze；已提供则复用）
console.log("==> LP mint");
const lpMint = USED_LP_MINT ?? (await createMint(conn, admin, poolAuthority, null, 6));
console.log("LP_MINT:", lpMint.toBase58());

// 3) 初始化池
console.log("==> initialize_pool");
const poolExists = Boolean(await conn.getAccountInfo(poolState));
if (!poolExists) {
  const tx = new Transaction();
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await latest()).blockhash;
  tx.add(new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: testUsdc, isSigner: false, isWritable: false },
      { pubkey: lpMint, isSigner: false, isWritable: false },
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: programData, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.concat([disc("initialize_pool"), admin.publicKey.toBuffer(), u64(86400n), Buffer.from([0])]), // require_multisig=false (devnet 测试)
  }));
  tx.sign(admin);
  await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), "confirmed");
  console.log("✅ pool initialized");
} else {
  console.log("pool 已存在");
}

// 4) mint 测试 USDC 给 admin + 池托管 + deposit
console.log("==> 给 admin mint 测试 USDC + 首次存款");
const adminAta = await getOrCreateAssociatedTokenAccount(conn, admin, testUsdc, admin.publicKey);
await mintTo(conn, admin, testUsdc, adminAta.address, admin, TEST_USDC_DEPOSIT);
console.log(`已 mint ${Number(TEST_USDC_DEPOSIT)/1e6} TEST_USDC 给 admin`);

const poolVault = await getOrCreateAssociatedTokenAccount(conn, admin, testUsdc, poolAuthority, true);
console.log("pool USDC ATA:", poolVault.address.toBase58());

// deposit_pool 指令
const tx2 = new Transaction();
tx2.feePayer = admin.publicKey;
tx2.recentBlockhash = (await latest()).blockhash;
const [adminLpAta] = [await getOrCreateAssociatedTokenAccount(conn, admin, lpMint, admin.publicKey)];
tx2.add(new TransactionInstruction({
  keys: [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: adminAta.address, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: poolVault.address, isSigner: false, isWritable: true },
    { pubkey: testUsdc, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: adminLpAta.address, isSigner: false, isWritable: true },
  ],
  programId,
  data: Buffer.concat([disc("deposit_pool"), u64(TEST_USDC_DEPOSIT)]),
}));
tx2.sign(admin);
await conn.confirmTransaction(await conn.sendRawTransaction(tx2.serialize()), "confirmed");
console.log("✅ deposit_pool 完成");

console.log("\n=== 输出（保存到 .env） ===");
console.log(`TEST_USDC_MINT=${testUsdc.toBase58()}`);
console.log(`LP_MINT=${lpMint.toBase58()}`);
console.log(`POOL=${poolState.toBase58()}`);
console.log(`TRADE_FINANCE_PROGRAM_ID=${programId.toBase58()}`);
console.log(`SUPPLY_CHAIN_PROGRAM_ID=${process.env.SUPPLY_CHAIN_PROGRAM_ID ?? "BGSBnaAs2uhsYhUA2KJBmirMcK551JLm9thy7P2y2cDh"}`);
console.log(`POOL_AUTHORITY=${poolAuthority.toBase58()}`);
console.log(`PLATFORM_WALLET=${admin.publicKey.toBase58()}`);
