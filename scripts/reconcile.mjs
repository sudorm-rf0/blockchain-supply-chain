#!/usr/bin/env node
// 链上 vs DB 对账（上线运维必需）：核对资金池状态、订单状态与资金恒等式。
//
// 用法（需在 backend 依赖可解析处运行，脚本已自定位）：
//   DATABASE_URL=... SOLANA_RPC_URL=... TRADE_FINANCE_PROGRAM_ID=... \
//   node scripts/reconcile.mjs [--json] [--max-snapshot-age-min 15]
//
// 退出码：0 = 无差异；1 = 发现差异（供告警）；2 = 执行错误
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { createRequire } from "node:module";
import { getAssociatedTokenAddress } from "@solana/spl-token";

const require = createRequire(
  new URL("../packages/backend/package.json", import.meta.url),
);
const { PrismaClient } = require("@prisma/client");

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const MAX_SNAPSHOT_AGE_MIN = Number(
  args.find((a) => a.startsWith("--max-snapshot-age-min="))?.split("=")[1] ??
    process.env.MAX_SNAPSHOT_AGE_MIN ??
    15,
);

const RPC = process.env.SOLANA_RPC_URL ?? "";
const PROGRAM_ID = process.env.TRADE_FINANCE_PROGRAM_ID;
const DATABASE_URL = process.env.DATABASE_URL;
if (!RPC || !PROGRAM_ID || !DATABASE_URL) {
  console.error("需要 SOLANA_RPC_URL / TRADE_FINANCE_PROGRAM_ID / DATABASE_URL");
  process.exit(2);
}

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const issues = [];
const warn = (msg) => issues.push({ level: "WARN", message: msg });
const err = (msg) => issues.push({ level: "ERROR", message: msg });

// ---- 链上解析（与 indexer parser 一致） ----
const DEAL_STATUS_BY_CODE = {
  0: "PENDING", 1: "FUNDED", 2: "IN_TRANSIT", 3: "CUSTOMS_CLEAR",
  4: "DELIVERED", 5: "REPAYING", 6: "SETTLED", 7: "DEFAULTED",
};
const U64 = 8;
function parsePool(data) {
  const o = 8 + 32;
  return {
    totalAssets: data.readBigUInt64LE(o),
    activeCapital: data.readBigUInt64LE(o + U64),
    reserveFund: data.readBigUInt64LE(o + 2 * U64),
    insuranceFund: data.readBigUInt64LE(o + 3 * U64),
    pendingDividends: data.readBigUInt64LE(o + 4 * U64),
  };
}
function parseDeal(data) {
  const o = 8;
  return {
    id: data.readBigUInt64LE(o),
    buyer: new PublicKey(data.subarray(o + U64, o + U64 + 32)).toBase58(),
    seller: new PublicKey(data.subarray(o + U64 + 32, o + U64 + 64)).toBase58(),
    amount: data.readBigUInt64LE(o + U64 + 64),
    downPayment: data.readBigUInt64LE(o + 2 * U64 + 64),
    poolPortion: data.readBigUInt64LE(o + 3 * U64 + 64),
    tenor: data.readBigInt64LE(o + 4 * U64 + 64),
    status: DEAL_STATUS_BY_CODE[data.readUInt8(o + 5 * U64 + 64)] ?? "UNKNOWN",
  };
}

const prog = new PublicKey(PROGRAM_ID);
const conn = new Connection(RPC, "confirmed");
const poolState = PublicKey.findProgramAddressSync(
  [Buffer.from("trade_finance"), Buffer.from("pool")],
  prog,
)[0];
const poolAuthority = PublicKey.findProgramAddressSync(
  [Buffer.from("trade_finance"), Buffer.from("pool_usdc")],
  prog,
)[0];
const encodeU64 = (v) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
const dealPda = (buyer, id) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("trade_finance"), Buffer.from("deal"), new PublicKey(buyer).toBuffer(), encodeU64(id)],
    prog,
  )[0];

const prisma = new PrismaClient();

async function main() {
  const poolInfo = await conn.getAccountInfo(poolState, "confirmed");
  if (!poolInfo) {
    err(`链上 PoolState 不存在：${poolState.toBase58()}`);
  } else {
    const chain = parsePool(poolInfo.data);
    const vault = await getAssociatedTokenAddress(
      new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
      poolAuthority,
      true,
    );
    const vaultInfo = await conn.getAccountInfo(vault, "confirmed");
    const vaultBalance = vaultInfo ? (await conn.getTokenAccountBalance(vault)).value.amount : "0";

    // 1) DB 快照 vs 链上
    const snap = await prisma.poolSnapshot.findFirst({ orderBy: { capturedAt: "desc" } });
    if (!snap) {
      warn("DB 无 PoolSnapshot（indexer 可能未运行）");
    } else {
      const ageMin = (Date.now() - snap.capturedAt.getTime()) / 60_000;
      if (ageMin > MAX_SNAPSHOT_AGE_MIN) {
        warn(`PoolSnapshot 过期 ${Math.round(ageMin)} 分钟（阈值 ${MAX_SNAPSHOT_AGE_MIN}），indexer 可能滞后`);
      }
      const cmp = (label, dbVal, chainVal) => {
        if (BigInt(dbVal ?? 0) !== chainVal) {
          err(`资金池 ${label} 不一致：DB=${dbVal} 链上=${chainVal}`);
        }
      };
      cmp("totalAssets", snap.totalAssets, chain.totalAssets);
      cmp("activeCapital", snap.activeCapital, chain.activeCapital);
      cmp("reserveFund", snap.reserveFund, chain.reserveFund);
      cmp("insuranceFund", snap.insuranceFund, chain.insuranceFund);
      cmp("pendingDividends", snap.pendingDividends, chain.pendingDividends);
    }

    // 2) 恒等式：total_assets == vault + 全部订单托管余额
    const deals = await prisma.tradeDeal.findMany({
      select: { dealId: true, buyerWallet: true },
    });
    let escrowSum = 0n;
    for (const d of deals) {
      const pda = dealPda(d.buyerWallet, BigInt(d.dealId));
      const ata = await getAssociatedTokenAddress(
        new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
        pda,
        true,
      );
      const ataInfo = await conn.getAccountInfo(ata, "confirmed");
      if (ataInfo) {
        escrowSum += BigInt((await conn.getTokenAccountBalance(ata)).value.amount);
      }
    }
    const invariant = chain.totalAssets === BigInt(vaultBalance) + escrowSum;
    if (!invariant) {
      err(
        `恒等式不符：total_assets=${chain.totalAssets} vault=${vaultBalance} 托管合计=${escrowSum}`,
      );
    }
  }

  // 3) 订单：DB 每条订单对链上核对
  const dbDeals = await prisma.tradeDeal.findMany();
  let checked = 0;
  for (const d of dbDeals) {
    const pda = dealPda(d.buyerWallet, BigInt(d.dealId));
    const info = await conn.getAccountInfo(pda, "confirmed");
    if (!info) {
      err(`订单 ${d.dealId} 链上账户不存在（DB=${d.status}）`);
      continue;
    }
    const chain = parseDeal(info.data);
    checked++;
    if (chain.id.toString(10) !== d.dealId) err(`订单 ${d.dealId} 链上 id=${chain.id}`);
    if (chain.buyer !== d.buyerWallet) err(`订单 ${d.dealId} buyer 不一致：DB=${d.buyerWallet} 链上=${chain.buyer}`);
    if (chain.seller !== d.sellerWallet) err(`订单 ${d.dealId} seller 不一致`);
    if (chain.amount.toString(10) !== d.amount.toString(10)) err(`订单 ${d.dealId} amount 不一致`);
    if (chain.downPayment.toString(10) !== d.downPayment.toString(10)) err(`订单 ${d.dealId} downPayment 不一致`);
    if (chain.poolPortion.toString(10) !== d.poolPortion.toString(10)) err(`订单 ${d.dealId} poolPortion 不一致`);
    if (chain.status !== d.status) {
      err(`订单 ${d.dealId} 状态不一致：DB=${d.status} 链上=${chain.status}`);
    }
  }

  await prisma.$disconnect();

  const report = {
    ok: issues.every((i) => i.level === "WARN") || issues.length === 0,
    checkedAt: new Date().toISOString(),
    rpc: RPC,
    poolState: poolState.toBase58(),
    dealsChecked: checked,
    issues,
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`对账完成：${new Date().toISOString()}`);
    console.log(`RPC=${RPC}  Pool=${report.poolState}  订单核对 ${checked}/${dbDeals.length}`);
    if (issues.length === 0) {
      console.log("✅ 无差异");
    } else {
      for (const i of issues) console.log(`  [${i.level}] ${i.message}`);
    }
  }

  const hasError = issues.some((i) => i.level === "ERROR");
  process.exit(hasError ? 1 : 0);
}

main().catch((e) => {
  console.error("对账执行失败:", e.message);
  process.exit(2);
});
