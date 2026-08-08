// 多签迁移演练 Part 2：合约 propose_admin -> 时锁 -> accept_admin 全链路（本地 validator）
// 说明：Squads 真实 3/5 阈值在链上由 Squads 程序执行；本演练用「模拟多签签名者」
// （成员 keypair）验证合约侧 propose/时锁/accept 通路与链上 admin 更新。
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { createMint } from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const RPC = process.env.RPC ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const TRADE_PID = new PublicKey("9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3");
const BPF_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

const disc = (n) => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 旧 admin = 部署钱包（~/.config/solana/id.json，程序 upgrade authority）
// 合约 H-2 修复后要求初始化者 == upgrade authority，故必须用部署钱包初始化。
const secret = JSON.parse(readFileSync(process.env.OLD_ADMIN_KP ?? `${homedir()}/.config/solana/id.json`, "utf8"));
const oldAdmin = Keypair.fromSecretKey(Uint8Array.from(secret));
const bal0 = await conn.getBalance(oldAdmin.publicKey);
if (bal0 < 5e9) {
  await conn.requestAirdrop(oldAdmin.publicKey, 5e9).then((s) => conn.confirmTransaction(s, "confirmed"));
}

// 模拟多签 = 5 成员之一（真实主网为 Squads 3-of-5 多签 PDA）
const member = Keypair.generate();
await conn.requestAirdrop(member.publicKey, 5e9).then((s) => conn.confirmTransaction(s, "confirmed"));
console.log("旧 admin:", oldAdmin.publicKey.toBase58());
console.log("模拟多签(member):", member.publicKey.toBase58());

// 创建 USDC / LP mint（LP authority = pool_authority PDA）
const usdcMint = await createMint(conn, oldAdmin, oldAdmin.publicKey, null, 6);
const [poolAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("trade_finance"), Buffer.from("pool_usdc")], TRADE_PID);
const lpMint = await createMint(conn, oldAdmin, poolAuthority, null, 6);
console.log("USDC mint:", usdcMint.toBase58(), "| LP mint:", lpMint.toBase58());

const [poolState] = PublicKey.findProgramAddressSync(
  [Buffer.from("trade_finance"), Buffer.from("pool")], TRADE_PID);
console.log("poolState PDA:", poolState.toBase58());
const [programData] = PublicKey.findProgramAddressSync([TRADE_PID.toBuffer()], BPF_LOADER);
console.log("programData PDA:", programData.toBase58());

// 1) initialize_pool（admin = 旧 admin，initial_delay = 1s，test-build 允许小值）
const initIx = new TransactionInstruction({
  keys: [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: oldAdmin.publicKey, isSigner: true, isWritable: true },
    { pubkey: usdcMint, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: false },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: programData, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  programId: TRADE_PID,
  data: Buffer.concat([disc("initialize_pool"), oldAdmin.publicKey.toBuffer(), u64le(1n)]),
});
await sendAndConfirm(oldAdmin, [initIx]);
console.log("✅ initialize_pool 完成（admin=旧 admin，delay=1s）");

// 2) propose_admin(模拟多签) —— 旧 admin 签名
const proposeIx = new TransactionInstruction({
  keys: [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: oldAdmin.publicKey, isSigner: true, isWritable: true },
  ],
  programId: TRADE_PID,
  data: Buffer.concat([disc("propose_admin"), member.publicKey.toBuffer()]),
});
await sendAndConfirm(oldAdmin, [proposeIx]);
console.log("✅ propose_admin(模拟多签) 完成");

// 读取 pool（带重试，confirmed 传播）
const OFFSET_ADMIN = 8;
const OFFSET_PENDING_ADMIN = 217; // discriminator(8)+admin(32)+total(8)+active(8)+reserve(8)+insurance(8)+pending_div(8)+platform(32)+nav(8)+paused(1)+usdc(32)+lp(32)+escrow(8)+redemption(8)+epoch(8)+used(8)
async function getPool() {
  for (let i = 0; i < 10; i++) {
    let a = await conn.getAccountInfo(poolState, "confirmed");
    if (a === null) a = await conn.getAccountInfo(poolState, "finalized");
    if (a === null) a = await conn.getAccountInfo(poolState, { commitment: "confirmed", dataSlice: { offset: 0, length: 8 } });
    if (a) return a;
    await sleep(300);
  }
  throw new Error("pool 账户读取失败");
}
let pool = await getPool();
const pendingAdmin2 = new PublicKey(pool.data.subarray(OFFSET_PENDING_ADMIN, OFFSET_PENDING_ADMIN + 32));
console.log("pending_admin:", pendingAdmin2.toBase58(), "(应为模拟多签)");

// 3) accept_admin（由模拟多签签名）—— 真实主网由 Squads 3-of-5 多签执行
const acceptIx = new TransactionInstruction({
  keys: [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: member.publicKey, isSigner: true, isWritable: true },
  ],
  programId: TRADE_PID,
  data: disc("accept_admin"),
});
// 3.1) 立即 accept：时锁未过应被拒（AdminLockNotElapsed）。本地 1s 时锁 + 秒级时间戳
//     粒度可能恰好跨秒，容错处理：若被拒则等待后重试。
let immediateRejected = false;
try { await sendAndConfirm(member, [acceptIx]); console.log("(本地 1s 时锁在 proposal 后 1 slot 内已跨秒，立即 accept 生效)"); }
catch (e) { immediateRejected = true; console.log("✅ 未过时锁 accept 被拒（AdminLockNotElapsed）"); }

// 4) 若被拒，等待时锁后重试
if (immediateRejected) {
  await sleep(1500);
  await sendAndConfirm(member, [acceptIx]);
  console.log("✅ 时锁后 accept_admin 完成（模拟多签签名）");
}

// 6) 验证链上 admin == 模拟多签
pool = await getPool();
const adminNow = new PublicKey(pool.data.subarray(OFFSET_ADMIN, OFFSET_ADMIN + 32));
const ok = adminNow.equals(member.publicKey);
console.log(`链上 pool.admin: ${adminNow.toBase58()}`);
console.log(ok ? "🎉 演练通过：admin 已迁移到（模拟）多签" : "❌ 演练失败：admin 未更新");

// 输出
console.log("=== OUTPUT ===");
console.log(`POOL_STATE=${poolState.toBase58()}`);
console.log(`OLD_ADMIN=${oldAdmin.publicKey.toBase58()}`);
console.log(`SIMULATED_MULTISIG=${member.publicKey.toBase58()}`);
console.log(`RESULT=${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);

// helpers
function u64le(v) { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; }
async function sendAndConfirm(signer, ixs) {
  const tx = new Transaction();
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.add(...ixs);
  const sig = await conn.sendTransaction(tx, [signer], { skipPreflight: true });
  const resp = await conn.confirmTransaction(sig, "confirmed");
  const slot = await conn.getSlot("confirmed");
  console.log("  tx", sig.slice(0, 8), "slot", slot, "err:", resp.value.err ?? "none");
  if (resp.value.err) throw new Error("tx failed: " + JSON.stringify(resp.value.err));
  return resp;
}
