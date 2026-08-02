// 初始化 localnet：USDC/LP Mint、资金池、5000 USDC 存款。
// 运行：node scripts/init-localnet.mjs
// 输出 USDC_MINT/LP_MINT/ADMIN 后，用这些值启动 trade-service。
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { TOKEN_PROGRAM_ID, createMint, createAssociatedTokenAccount, mintTo, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

const RPC = process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
const PROGRAM_ID = process.env.TRADE_FINANCE_PROGRAM_ID ?? "9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3";
const DEPOSIT_USDC = BigInt(process.env.DEPOSIT_USDC ?? 5_000_000_000);

const conn = new Connection(RPC, "confirmed");
const adminSecret = JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"));
const admin = Keypair.fromSecretKey(Uint8Array.from(adminSecret));
const programId = new PublicKey(PROGRAM_ID);

const usdcMint = await createMint(conn, admin, admin.publicKey, admin.publicKey, 6, Keypair.generate());
console.log(`USDC_MINT=${usdcMint.toBase58()}`);
const lpMint = await createMint(conn, admin, admin.publicKey, admin.publicKey, 6, Keypair.generate());
console.log(`LP_MINT=${lpMint.toBase58()}`);

const adminAta = await createAssociatedTokenAccount(conn, admin, usdcMint, admin.publicKey);
await mintTo(conn, admin, usdcMint, adminAta, admin.publicKey, DEPOSIT_USDC * 2n);
const adminLpAta = await createAssociatedTokenAccount(conn, admin, lpMint, admin.publicKey);
await mintTo(conn, admin, lpMint, adminLpAta, admin.publicKey, 1_000_000_000);

const poolState = PublicKey.findProgramAddressSync([Buffer.from("trade_finance"), Buffer.from("pool")], programId)[0];
const poolAuthority = PublicKey.findProgramAddressSync([Buffer.from("trade_finance"), Buffer.from("pool_usdc")], programId)[0];
const poolTokenAccount = (await getOrCreateAssociatedTokenAccount(conn, admin, usdcMint, poolAuthority, true)).address;

const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const latest = () => conn.getLatestBlockhash("confirmed");

if (!(await conn.getAccountInfo(poolState))) {
  const tx = new Transaction();
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await latest()).blockhash;
  tx.add(new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.concat([disc("initialize_pool"), admin.publicKey.toBuffer()]),
  }));
  tx.sign(admin);
  await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), "confirmed");
  console.log("pool initialized");
}

const tx = new Transaction();
tx.feePayer = admin.publicKey;
tx.recentBlockhash = (await latest()).blockhash;
tx.add(new TransactionInstruction({
  keys: [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: adminAta, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
    { pubkey: usdcMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: false },
  ],
  programId,
  data: Buffer.concat([disc("deposit_pool"), u64(DEPOSIT_USDC)]),
}));
tx.sign(admin);
await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), "confirmed");
console.log(`deposited ${DEPOSIT_USDC / 1_000_000n} USDC`);
console.log(`POOL=${poolState.toBase58()}`);
console.log(`ADMIN=${admin.publicKey.toBase58()}`);
