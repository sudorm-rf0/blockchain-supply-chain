// devnet 新版合约完整业务链路 e2e（create → fund → release → repay → redeem）
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = process.env.TRADE_FINANCE_PROGRAM_ID ?? "8GSbCjUhgpvgQ35tx7wqFZCznP5HW2mn1jUYcGahC4tq";
const USDC_MINT = process.env.USDC_MINT ?? "9N7QUgFr1MviKhWBAikKYuCFLHqZzMyGGuy5wabwoQhF";
const LP_MINT = process.env.LP_MINT ?? "516Wdy9BN239rJ3f44fY4kVccriWawFRTK8K8xdP2zmy";
const KEYPAIR_PATH = process.env.SOLANA_KEYPAIR_PATH ?? "packages/contracts/target/deploy/devnet-new/deployer-keypair.json";

const conn = new Connection(RPC, "confirmed");
const secret = JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"));
const admin = Keypair.fromSecretKey(Uint8Array.from(secret));
const programId = new PublicKey(PROGRAM_ID);
const usdcMint = new PublicKey(USDC_MINT);
const lpMint = new PublicKey(LP_MINT);
const seller = Keypair.generate();

const [poolState] = PublicKey.findProgramAddressSync([Buffer.from("trade_finance"), Buffer.from("trade_pool")], programId);
const [poolAuthority] = PublicKey.findProgramAddressSync([Buffer.from("trade_finance"), Buffer.from("trade_pool_usdc")], programId);
const dealPda = (buyer, id) => {
  const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(id));
  return PublicKey.findProgramAddressSync([Buffer.from("trade_finance"), Buffer.from("deal"), buyer.toBuffer(), b], programId)[0];
};
const rebatePda = (buyer) => PublicKey.findProgramAddressSync([Buffer.from("trade_finance"), Buffer.from("rebate"), buyer.toBuffer()], programId)[0];
const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const latest = () => conn.getLatestBlockhash("confirmed");
const send = async (tx, signers) => {
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await latest()).blockhash;
  tx.sign(admin, ...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
};

const TRADE_ID = BigInt(Date.now() % 1_000_000_000);
const AMOUNT = 20_000_000n; // 20 USDC (pool_portion 14 ≤ 1% 集中度 16)
console.log("买家(admin):", admin.publicKey.toBase58());
console.log("卖家:", seller.publicKey.toBase58());
console.log("订单ID:", TRADE_ID.toString());

// 准备 ATA
console.log("\n==> 准备 ATA");
const buyerUsdcAta = (await getOrCreateAssociatedTokenAccount(conn, admin, usdcMint, admin.publicKey)).address;
const buyerLpAta = (await getOrCreateAssociatedTokenAccount(conn, admin, lpMint, admin.publicKey)).address;
const sellerUsdcAta = (await getOrCreateAssociatedTokenAccount(conn, admin, usdcMint, seller.publicKey)).address;
const platformAta = buyerUsdcAta; // admin 即平台
const deal = dealPda(admin.publicKey, TRADE_ID);
const dealAta = (await getOrCreateAssociatedTokenAccount(conn, admin, usdcMint, deal, true)).address;
console.log("deal PDA:", deal.toBase58());

// 0) pool vault ATA
const poolVaultCreate = (await getOrCreateAssociatedTokenAccount(conn, admin, usdcMint, poolAuthority, true)).address;

// 0.5) mint 测试 USDC 给买家（USDC mint authority = admin）
await mintTo(conn, admin, usdcMint, buyerUsdcAta, admin, BigInt(50_000_000));

// 1) create_deal
console.log("\n==> create_deal (50 USDC, 30% 首付)");
{
  const tx = new Transaction();
  tx.add(new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: deal, isSigner: false, isWritable: true },
      { pubkey: buyerUsdcAta, isSigner: false, isWritable: true },
      { pubkey: dealAta, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: poolVaultCreate, isSigner: false, isWritable: true },
    ],
    programId,
    data: Buffer.concat([disc("create_deal"), u64(TRADE_ID), seller.publicKey.toBuffer(), u64(AMOUNT), u64(30n)]),
  }));
  const sig = await send(tx, []);
  console.log("✅ create_deal", sig.slice(0, 12));
}

// 2) fund_deal
console.log("\n==> fund_deal (admin 放款 35)");
{
  const poolVault = (await getOrCreateAssociatedTokenAccount(conn, admin, usdcMint, poolAuthority, true)).address;
  const tx = new Transaction();
  tx.add(new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: admin.publicKey, isSigner: false, isWritable: false }, // buyer (accountinfo)
      { pubkey: deal, isSigner: false, isWritable: true },
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: poolVault, isSigner: false, isWritable: true },
      { pubkey: dealAta, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: lpMint, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.concat([disc("fund_deal"), u64(TRADE_ID)]),
  }));
  const sig = await send(tx, []);
  console.log("✅ fund_deal", sig.slice(0, 12));
}

// 2.5) advance_deal x3 (FUNDED -> IN_TRANSIT -> CUSTOMS_CLEAR -> DELIVERED)
console.log("\n==> advance_deal (物流推进到 DELIVERED)");
{
  for (const target of [2, 3, 4]) {
    const tx = new Transaction();
    tx.add(new TransactionInstruction({
      keys: [
        { pubkey: poolState, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: admin.publicKey, isSigner: false, isWritable: false },
        { pubkey: deal, isSigner: false, isWritable: true },
      ],
      programId,
      data: Buffer.concat([disc("advance_deal"), u64(TRADE_ID), Buffer.from([target])]),
    }));
    const sig = await send(tx, []);
    console.log("✅ advance_deal ->", target, sig.slice(0, 12));
  }
}

// 3) release_to_seller
console.log("\n==> release_to_seller (释放 20 给卖家)");
{
  const tx = new Transaction();
  tx.add(new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: admin.publicKey, isSigner: false, isWritable: false }, // buyer
      { pubkey: deal, isSigner: false, isWritable: true },
      { pubkey: dealAta, isSigner: false, isWritable: true },
      { pubkey: sellerUsdcAta, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.concat([disc("release_to_seller"), u64(TRADE_ID)]),
  }));
  const sig = await send(tx, []);
  console.log("✅ release_to_seller", sig.slice(0, 12));
}

// 4) repay_deal
console.log("\n==> repay_deal (买方还款 35 + 费用)");
{
  const poolVault = (await getOrCreateAssociatedTokenAccount(conn, admin, usdcMint, poolAuthority, true)).address;
  const rebate = rebatePda(admin.publicKey);
  const tx = new Transaction();
  tx.add(new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: deal, isSigner: false, isWritable: true },
      { pubkey: buyerUsdcAta, isSigner: false, isWritable: true },
      { pubkey: platformAta, isSigner: false, isWritable: true },
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: poolVault, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: lpMint, isSigner: false, isWritable: false },
      { pubkey: rebate, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.concat([disc("repay_deal"), u64(TRADE_ID)]),
  }));
  const sig = await send(tx, []);
  console.log("✅ repay_deal", sig.slice(0, 12));
}

// 5) redeem_lp
console.log("\n==> redeem_lp (赎回 500 LP)");
{
  const poolVault = (await getOrCreateAssociatedTokenAccount(conn, admin, usdcMint, poolAuthority, true)).address;
  const tx = new Transaction();
  tx.add(new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: buyerLpAta, isSigner: false, isWritable: true },
      { pubkey: buyerUsdcAta, isSigner: false, isWritable: true },
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: poolVault, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.concat([disc("redeem_lp"), u64(500_000_000n)]),
  }));
  const sig = await send(tx, []);
  console.log("✅ redeem_lp", sig.slice(0, 12));
}

console.log("\n=== 全链路完成 ===");
console.log("TRADE_ID:", TRADE_ID.toString());
console.log("seller:", seller.publicKey.toBase58());
