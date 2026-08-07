#!/usr/bin/env node
// LP 资金池冒烟：存款(deposit_pool) → 赎回(redeem_lp) → 分红(distribute_dividends)，逐项断言链上状态。
// 覆盖端到端冒烟清单 E1–E3（真实资金路径）。
//
// 用法：
//   node scripts/smoke-lp.mjs
// Env：
//   SOLANA_RPC_URL                默认 http://localhost:8899
//   TRADE_FINANCE_PROGRAM_ID      默认 devnet 占位
//   USDC_MINT / LP_MINT           必须设置
//   ADMIN_KEYPAIR                 admin 钱包（分红用），默认 ~/.config/solana/id.json
//   LP_FUND_USDC                  测试环境给 LP 铸造 USDC 的金额（USDC 原始单位，默认 0=不铸造）
//   DEPOSIT_USDC / REDEEM_LP / DIVIDEND_USDC  冒烟金额（默认 1_000_000_000 / 100_000_000 / 50_000_000）
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAccount,
  getMint,
  mintTo,
} from "@solana/spl-token";
import { AnchorProvider, Program, BN, Wallet } from "@coral-xyz/anchor";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const RPC = process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
const PROGRAM_ID = process.env.TRADE_FINANCE_PROGRAM_ID ?? "9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3";
const USDC_MINT = process.env.USDC_MINT;
const LP_MINT = process.env.LP_MINT;
const ADMIN_KP = process.env.ADMIN_KEYPAIR ?? path.join(homedir(), ".config/solana/id.json");
const LP_FUND_USDC = BigInt(process.env.LP_FUND_USDC ?? 0);
const DEPOSIT_USDC = BigInt(process.env.DEPOSIT_USDC ?? "1000000000");       // 1000 USDC
const REDEEM_LP = BigInt(process.env.REDEEM_LP ?? "100000000");              // 100 LP（1e8，decimals 0）
const DIVIDEND_USDC = BigInt(process.env.DIVIDEND_USDC ?? "50000000");       // 50 USDC

if (!USDC_MINT || !LP_MINT) {
  console.error("❌ 必须设置 USDC_MINT 和 LP_MINT");
  process.exit(1);
}

const conn = new Connection(RPC, "confirmed");
const provider = new AnchorProvider(conn, new Wallet(Keypair.generate()), { commitment: "confirmed" });
const program = new Program(JSON.parse(readFileSync(path.join(process.cwd(), "packages/contracts/target/idl/trade_finance.json"), "utf8")), PROGRAM_ID, provider);

const adminSecret = JSON.parse(readFileSync(ADMIN_KP, "utf8"));
const admin = Keypair.fromSecretKey(Uint8Array.from(adminSecret));
const lp = Keypair.generate();

const poolStatePda = PublicKey.findProgramAddressSync(
  [Buffer.from("trade_finance"), Buffer.from("pool")], new PublicKey(PROGRAM_ID))[0];
const poolAuthorityPda = PublicKey.findProgramAddressSync(
  [Buffer.from("trade_finance"), Buffer.from("pool_usdc")], new PublicKey(PROGRAM_ID))[0];

async function airdrop(pubkey, lamports = 2 * LAMPORTS_PER_SOL) {
  const sig = await conn.requestAirdrop(pubkey, lamports);
  await conn.confirmTransaction(sig, "confirmed");
}

async function ata(mint, owner, allowOwnerOffCurve = false) {
  return (await getOrCreateAssociatedTokenAccount(conn, lp, mint, owner, allowOwnerOffCurve)).address;
}

(async () => {
  const results = {};
  await airdrop(lp.publicKey);
  const usdcMint = new PublicKey(USDC_MINT);
  const lpMint = new PublicKey(LP_MINT);
  const lpUsdcAta = await ata(usdcMint, lp.publicKey);
  const lpLpAta = await ata(lpMint, lp.publicKey);
  const poolTokenAccount = await ata(usdcMint, poolAuthorityPda, true);
  const poolInfo = await conn.getAccountInfo(poolStatePda);
  if (!poolInfo) { console.error("❌ 资金池未初始化（先 init 或 init-localnet/init-mainnet-pool）"); process.exit(1); }

  // 测试/本地：给 LP 铸造 USDC
  if (LP_FUND_USDC > 0n) {
    await mintTo(conn, lp, usdcMint, lpUsdcAta, lp.publicKey, LP_FUND_USDC);
  }

  // ---- E1 存款 ----
  const lpBefore = (await getAccount(conn, lpLpAta)).amount;
  await program.methods.depositPool(new BN(DEPOSIT_USDC.toString()))
    .accounts({
      poolState: poolStatePda, depositor: lp.publicKey, depositorTokenAccount: lpUsdcAta,
      poolAuthority: poolAuthorityPda, poolTokenAccount, usdcMint,
      tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      lpMint, depositorLpTokenAccount: lpLpAta,
    })
    .signers([lp]).rpc();
  const lpAfterDeposit = (await getAccount(conn, lpLpAta)).amount;
  results.deposit = lpAfterDeposit > lpBefore;
  console.log(`${results.deposit ? "✅" : "❌"} E1 存款：LP ${lpBefore} -> ${lpAfterDeposit}`);

  // ---- E2 赎回 ----
  const usdcBeforeRedeem = (await getAccount(conn, lpUsdcAta)).amount;
  const poolSnapBefore = await program.account.poolState.fetch(poolStatePda);
  await program.methods.redeemLp(new BN(REDEEM_LP.toString()))
    .accounts({
      poolState: poolStatePda, lpUser: lp.publicKey, lpUserTokenAccount: lpLpAta,
      lpUserUsdcTokenAccount: lpUsdcAta, poolAuthority: poolAuthorityPda, poolTokenAccount,
      usdcMint, lpMint, tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    })
    .signers([lp]).rpc();
  const usdcAfterRedeem = (await getAccount(conn, lpUsdcAta)).amount;
  const lpAfterRedeem = (await getAccount(conn, lpLpAta)).amount;
  results.redeem = usdcAfterRedeem > usdcBeforeRedeem && lpAfterRedeem < lpAfterDeposit;
  console.log(`${results.redeem ? "✅" : "❌"} E2 赎回：USDC +${usdcAfterRedeem - usdcBeforeRedeem}, LP ${lpAfterDeposit} -> ${lpAfterRedeem}`);

  // ---- E3 分红（admin 签发给 LP 持有者，L-11 按占比限制） ----
  const lpUsdcAta2 = lpUsdcAta; // recipient = LP 用户（唯一 LP 时占比 100%）
  const dividendClaimPda = PublicKey.findProgramAddressSync(
    [Buffer.from("trade_finance"), Buffer.from("dividend_claim"), lp.publicKey.toBuffer()],
    new PublicKey(PROGRAM_ID))[0];
  const poolAfterRedeem = await program.account.poolState.fetch(poolStatePda);
  const pending = poolAfterRedeem.pendingDividends;
  if (pending.eq(new BN(0))) {
    console.log("ℹ️ 无待分配分红，跳过 E3（可先跑订单还款产生分红）");
    results.dividend = "skipped";
  } else {
    const usdcBeforeDiv = (await getAccount(conn, lpUsdcAta2)).amount;
    const divAmount = pending.lt(new BN(DIVIDEND_USDC.toString())) ? pending : new BN(DIVIDEND_USDC.toString());
    await program.methods.distributeDividends(divAmount)
      .accounts({
        poolState: poolStatePda, admin: admin.publicKey, recipient: lp.publicKey,
        recipientTokenAccount: lpUsdcAta2, recipientLpTokenAccount: lpLpAta,
        poolAuthority: poolAuthorityPda, poolTokenAccount, usdcMint,
        tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        lpMint, dividendClaim: dividendClaimPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin]).rpc();
    const usdcAfterDiv = (await getAccount(conn, lpUsdcAta2)).amount;
    const pendingAfter = (await program.account.poolState.fetch(poolStatePda)).pendingDividends;
    results.dividend = usdcAfterDiv > usdcBeforeDiv && pendingAfter.lt(pending);
    console.log(`${results.dividend === true ? "✅" : "❌"} E3 分红：LP +${usdcAfterDiv - usdcBeforeDiv}, pending ${pending} -> ${pendingAfter}`);
  }

  console.log("\n===== smoke-lp 汇总 =====");
  for (const [k, v] of Object.entries(results)) console.log(`  ${k}: ${v}`);
  const ok = Object.values(results).every((v) => v === true || v === "skipped");
  console.log(ok ? "smoke-lp: PASS" : "smoke-lp: FAIL");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("❌ smoke-lp 异常:", e.message); process.exit(1); });
