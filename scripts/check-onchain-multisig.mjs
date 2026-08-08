#!/usr/bin/env node
// 读取链上 PoolState / Registry 的 multisig 字段，断言其已实际配置（非 None）。
// H-1 真正根治的硬门：仅当链上 multisig 非 None 时才允许主网上线（消除出厂单管理员）。
//
// 依赖：node + @coral-xyz/anchor + @solana/web3.js（在 contracts 构建环境运行）。
// Env：
//   SOLANA_RPC_URL            （必填）
//   TRADE_FINANCE_PROGRAM_ID （必填）
//   SUPPLY_CHAIN_PROGRAM_ID  （必填）
//   MULTISIG_ADMIN           （可选；若设置则额外断言链上 multisig == 该 PDA）
//   CONTRACTS_DIR            （默认 packages/contracts；须含 target/idl/*.json）
//
// 退出码：0 = 已强制配置；1 = 未配置 / 读取失败 / 依赖缺失。
import { readFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";

const RPC = process.env.SOLANA_RPC_URL;
const TRADE = process.env.TRADE_FINANCE_PROGRAM_ID;
const SUPPLY = process.env.SUPPLY_CHAIN_PROGRAM_ID;
const EXPECT = process.env.MULTISIG_ADMIN || null;
const CONTRACTS = process.env.CONTRACTS_DIR || "packages/contracts";

function fail(msg) { console.error("MULTISIG-CHECK FAIL:", msg); process.exit(1); }
if (!RPC || !TRADE || !SUPPLY) {
  fail("SOLANA_RPC_URL / TRADE_FINANCE_PROGRAM_ID / SUPPLY_CHAIN_PROGRAM_ID 必须设置");
}

const conn = new Connection(RPC, "confirmed");
// 只读钱包（不会签名）：用系统程序占位公钥。
const wallet = {
  publicKey: new PublicKey("11111111111111111111111111111111"),
  signTransaction: async () => { throw new Error("readonly"); },
  signAllTransactions: async () => { throw new Error("readonly"); },
};
const provider = new AnchorProvider(conn, wallet, { commitment: "confirmed" });

function loadIdl(name) {
  try {
    return JSON.parse(readFileSync(`${CONTRACTS}/target/idl/${name}.json`, "utf8"));
  } catch (e) {
    fail(`无法加载 IDL ${CONTRACTS}/target/idl/${name}.json（请先 anchor build）: ${e.message}`);
  }
}
const tradeProg = new Program({ ...loadIdl("trade_finance"), address: new PublicKey(TRADE) }, provider);
const supplyProg = new Program({ ...loadIdl("supply_chain"), address: new PublicKey(SUPPLY) }, provider);
const [poolPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("trade_finance"), Buffer.from("pool")], new PublicKey(TRADE),
);
const [regPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("supply_chain"), Buffer.from("registry")], new PublicKey(SUPPLY),
);

async function main() {
  let pool, reg;
  try { pool = await tradeProg.account.poolState.fetch(poolPda); }
  catch (e) { fail(`读取 PoolState(${poolPda.toBase58()}) 失败：${e.message}`); }
  try { reg = await supplyProg.account.registry.fetch(regPda); }
  catch (e) { fail(`读取 Registry(${regPda.toBase58()}) 失败：${e.message}`); }

  if (!pool.multisig) {
    fail("PoolState.multisig 为 None（出厂单管理员未消除）。请先运行 scripts/configure-multisig.mjs 配置 Squads 多签。");
  }
  if (!reg.multisig) {
    fail("Registry.multisig 为 None。请先运行 scripts/configure-multisig.mjs 配置 Squads 多签。");
  }
  if (EXPECT) {
    if (pool.multisig.toBase58() !== EXPECT) {
      fail(`PoolState.multisig(${pool.multisig.toBase58()}) != MULTISIG_ADMIN(${EXPECT})`);
    }
    if (reg.multisig.toBase58() !== EXPECT) {
      fail(`Registry.multisig(${reg.multisig.toBase58()}) != MULTISIG_ADMIN(${EXPECT})`);
    }
  }
  console.log(
    "MULTISIG-CHECK PASS: PoolState/Registry.multisig 均已配置 =",
    pool.multisig.toBase58(),
  );
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
