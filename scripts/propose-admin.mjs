#!/usr/bin/env node
// 管理员迁移第一步：旧 admin 签名发起 propose_admin / propose_registry_admin，
// 把 pool.admin / registry.admin 迁移到 Squads 多签 PDA（H-03 两步轮换）。
//
// 用法：
//   SOLANA_RPC_URL=... TARGET=trade|supply NEW_ADMIN=<多签PDA> \
//     SOLANA_KEYPAIR_PATH=<旧admin keypair> node scripts/propose-admin.mjs
// 可选：TRADE_FINANCE_PROGRAM_ID / SUPPLY_CHAIN_PROGRAM_ID（默认仓库已提交 ID）
//
// 输出：提案 pending_admin、proposed_at、可接受时间（proposed_at + delay_secs）。
// 之后由多签在 Squads 中执行 accept_admin / accept_registry_admin（需等时锁期满）。
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const RPC = process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
const TARGET = process.env.TARGET ?? "";
const NEW_ADMIN = process.env.NEW_ADMIN ?? "";
const TRADE_PID = process.env.TRADE_FINANCE_PROGRAM_ID ?? "9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3";
const SUPPLY_PID = process.env.SUPPLY_CHAIN_PROGRAM_ID ?? "Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk";

if (TARGET !== "trade" && TARGET !== "supply") {
  console.error("❌ TARGET 必须为 trade 或 supply");
  process.exit(2);
}
if (!NEW_ADMIN) {
  console.error("❌ 必须设置 NEW_ADMIN（Squads 多签 PDA）");
  process.exit(2);
}
let newAdmin;
try {
  newAdmin = new PublicKey(NEW_ADMIN);
} catch {
  console.error("❌ NEW_ADMIN 不是合法 Solana 地址");
  process.exit(2);
}

const keypairPath =
  process.env.SOLANA_KEYPAIR_PATH ?? `${homedir()}/.config/solana/id.json`;
const secret = JSON.parse(readFileSync(keypairPath, "utf8"));
const oldAdmin = Keypair.fromSecretKey(Uint8Array.from(secret));

const conn = new Connection(RPC, "confirmed");
const disc = (name) =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

const programId = new PublicKey(TARGET === "trade" ? TRADE_PID : SUPPLY_PID);
const stateSeed = TARGET === "trade" ? "pool" : "registry";
const statePda = PublicKey.findProgramAddressSync(
  [Buffer.from(TARGET === "trade" ? "trade_finance" : "supply_chain"), Buffer.from(stateSeed)],
  programId,
)[0];
const ixName = TARGET === "trade" ? "propose_admin" : "propose_registry_admin";

const tx = new Transaction();
tx.feePayer = oldAdmin.publicKey;
tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
tx.add(
  new TransactionInstruction({
    keys: [
      { pubkey: statePda, isSigner: false, isWritable: true },
      { pubkey: oldAdmin.publicKey, isSigner: true, isWritable: true },
    ],
    programId,
    data: Buffer.concat([disc(ixName), newAdmin.toBuffer()]),
  }),
);
tx.sign(oldAdmin);
const rawSig = await conn.sendRawTransaction(tx.serialize());
await conn.confirmTransaction(rawSig, "confirmed");
console.log(`✅ ${TARGET === "trade" ? "pool.admin" : "registry.admin"} 迁移已提案`);
console.log(`   指令: ${ixName}`);
console.log(`   旧 admin: ${oldAdmin.publicKey.toBase58()}`);
console.log(`   新 admin（多签）: ${newAdmin.toBase58()}`);
console.log(`   状态账户: ${statePda.toBase58()}`);
console.log(`   签名: ${rawSig}`);
console.log("");
console.log("下一步（等时锁期满后由多签在 Squads 中执行 accept）:");
console.log(`   trade:   accept_admin     accounts: pool_state=${statePda}, new_admin(signer)=${newAdmin.toBase58()}`);
console.log(`   supply:  accept_registry_admin  accounts: registry=${statePda}, new_admin(signer)=${newAdmin.toBase58()}`);
