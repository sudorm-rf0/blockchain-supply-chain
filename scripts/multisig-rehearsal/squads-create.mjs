// Squads 3-of-5 多签创建（devnet/主网/localnet）
// 依赖：npm i @sqds/multisig@2.1.4 @solana/web3.js@1（Node >= 20）
// 用法：
//   MEMBERS="<addr1>,<addr2>,<addr3>,<addr4>,<addr5>" \
//   THRESHOLD=3 \
//   PAYER_KP=~/.config/solana/id.json \
//   RPC=https://api.devnet.solana.com \
//   node scripts/multisig-rehearsal/squads-create.mjs
// 说明：payer 必须是普通钱包（不能是 Program ID 账户）；PDA = f(createKey=payer)，固定。
// 幂等：多签已存在时直接链上验证并输出。
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { rpc, types, getMultisigPda, accounts, PROGRAM_ADDRESS } from "@sqds/multisig";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const THRESHOLD = Number(process.env.THRESHOLD ?? 3);
const DEFAULT_MEMBERS = [
  "DKjZeYsBiGLCNUChyrKURWfEYxuWR3NLwnwtHgVghSpN",
  "F4WD7tD8EqjWxp3t6w6pusBEvVHZDrTtZsRu6LDx3tvF",
  "SidAeEGsn2yqgqHzSaCRLPeR7jb31cMTAwA9KLQq2bP",
  "2y5tHWpVfNzmYzngW4bGqRV4tANqdbsZNUaWVFRTopXd",
  "Cw8hnS6tky3w6MmxmrnaSdZ2afCHQYbxq2QZBbUcyU6S",
];
const members = (process.env.MEMBERS ?? DEFAULT_MEMBERS.join(","))
  .split(",").map((s) => s.trim()).filter(Boolean)
  .map((k) => new PublicKey(k));
if (members.length < 2) { console.error("❌ 至少需要 2 个成员地址"); process.exit(2); }

const conn = new Connection(RPC, "confirmed");
const secret = JSON.parse(
  readFileSync(process.env.PAYER_KP ?? `${homedir()}/.config/solana/id.json`, "utf8"),
);
const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
console.log("payer (createKey):", payer.publicKey.toBase58());

const bal = await conn.getBalance(payer.publicKey);
console.log("payer balance:", bal / 1e9, "SOL");
if (bal < 5_000_000) { console.error("❌ payer 余额不足 0.005 SOL（需支付多签租金+手续费）"); process.exit(1); }

const [multisigPda] = getMultisigPda({ createKey: payer.publicKey });
console.log("multisig PDA (将作为合约 admin):", multisigPda.toBase58());

// Squads V4 (SQDS4ep65) 要求 treasury == ProgramConfig.treasury（全局收款地址）
const [programConfigPda] = (await import("@sqds/multisig")).getProgramConfigPda({ programId: new PublicKey(PROGRAM_ADDRESS) });
const programConfigAcc = await conn.getAccountInfo(programConfigPda);
if (!programConfigAcc) { console.error("❌ 找不到 Squads ProgramConfig 账户"); process.exit(1); }
const treasury = new PublicKey(programConfigAcc.data.subarray(8, 40));
console.log("Squads treasury:", treasury.toBase58());

// 幂等：已存在则验证
const existing = await accounts.Multisig.fromAccountAddress(conn, multisigPda).catch(() => null);
if (existing) {
  console.log("✅ 多签已存在（幂等命中），链上验证：");
  console.log("  threshold:", existing.threshold, "/ members:", existing.members.length);
  existing.members.forEach((m, i) => console.log(`    ${i + 1}: ${m.key.toBase58()}`));
  console.log("=== OUTPUT ===");
  console.log(`MULTISIG_PDA=${multisigPda.toBase58()}`);
  console.log(`MULTISIG_PROGRAM=${PROGRAM_ADDRESS}`);
  process.exit(0);
}

try {
  const sig = await rpc.multisigCreateV2({
    connection: conn,
    treasury,
    createKey: payer,
    creator: payer, // 2.x API 要求 Keypair（内部 tx.sign([creator, createKey])）
    multisigPda,
    configAuthority: null,
    threshold: THRESHOLD,
    members: members.map((k) => ({ key: k, permissions: types.Permissions.all() })),
    timeLock: 0,
    rentCollector: null,
    sendOptions: { skipPreflight: false, preflightCommitment: "confirmed" },
    programId: new PublicKey(PROGRAM_ADDRESS),
  });
  console.log("create multisig tx:", sig);
  await conn.confirmTransaction(sig, "confirmed");
} catch (err) {
  console.error("❌ 创建失败:", err.message ?? err);
  if (err.logs) console.error("logs:", JSON.stringify(err.logs, null, 1));
  process.exit(1);
}

// 链上验证
const ms = await accounts.Multisig.fromAccountAddress(conn, multisigPda);
console.log("✅ 多签创建成功并链上验证：");
console.log("  threshold:", ms.threshold, "(of", ms.members.length + ")");
ms.members.forEach((m, i) => console.log(`    ${i + 1}: ${m.key.toBase58()}`));
console.log("  timeLock:", ms.timeLock.toString());
console.log("=== OUTPUT ===");
console.log(`MULTISIG_PDA=${multisigPda.toBase58()}`);
console.log(`MULTISIG_PROGRAM=${PROGRAM_ADDRESS}`);
console.log(`THRESHOLD=${THRESHOLD} OF ${members.length}`);
