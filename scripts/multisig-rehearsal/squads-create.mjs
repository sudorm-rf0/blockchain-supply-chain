// Squads 3-of-5 多签创建（devnet/主网）— 演练 Part 1：多签基础设施
// 依赖：npm i @sqds/multisig @solana/web3.js
// 用法：RPC=<url> node scripts/multisig-rehearsal/squads-create.mjs
//   默认 RPC=http://127.0.0.1:8899（本地 validator 演练）；主网/devnet 需 RPC + payer 有 SOL。
// 输出：MULTISIG_PDA（写入 production.env 的 MULTISIG_ADMIN）、成员地址、keypair 存档位置。
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { rpc, types, getMultisigPda, accounts, PROGRAM_ADDRESS } from "@sqds/multisig";

const RPC = process.env.RPC ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");

const payer = Keypair.generate();
console.log("payer:", payer.publicKey.toBase58());

// airdrop（devnet 配额有限，请求多次）
let got = 0;
for (let i = 0; i < 5 && got < LAMPORTS_PER_SOL; i++) {
  try {
    const sig = await conn.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
    got += LAMPORTS_PER_SOL;
  } catch (e) { /* rate limited */ }
}
const bal = await conn.getBalance(payer.publicKey);
console.log("payer balance:", bal / LAMPORTS_PER_SOL, "SOL");
if (bal < 1 * LAMPORTS_PER_SOL) { console.error("❌ 空投不足"); process.exit(1); }

// 5 个成员（测试 keypair，演练用）
const members = Array.from({ length: 5 }, () => Keypair.generate());
console.log("members:");
members.forEach((m, i) => console.log(`  m${i + 1}: ${m.publicKey.toBase58()}`));

const [multisigPda] = getMultisigPda({ createKey: payer.publicKey });
console.log("multisig PDA:", multisigPda.toBase58());

// 创建 3-of-5 多签
const sig = await rpc.multisigCreateV2({
  connection: conn,
  treasury: payer.publicKey,
  createKey: payer,
  creator: payer.publicKey,
  multisigPda,
  configAuthority: null,
  threshold: 3,
  members: members.map((m) => ({ key: m.publicKey, permissions: types.Permissions.all() })),
  timeLock: 0,
  rentCollector: null,
  sendOptions: { skipPreflight: false },
  programId: new PublicKey(PROGRAM_ADDRESS),
});
console.log("create multisig tx:", sig);

// 验证
const ms = await accounts.Multisig.fromAccountAddress(conn, multisigPda);
console.log("✅ multisig 创建成功");
console.log("  threshold:", ms.threshold, "(3-of-5)");
console.log("  members:", ms.members.length);
console.log("  timeLock:", ms.timeLock.toString());

// 输出供后续使用
console.log("=== OUTPUT ===");
console.log(`MULTISIG_PDA=${multisigPda.toBase58()}`);
console.log(`MULTISIG_PROGRAM=${PROGRAM_ADDRESS}`);
console.log(`PAYER=${payer.publicKey.toBase58()}`);
console.log(`MEMBER_PUBKEYS=${members.map((m) => m.publicKey.toBase58()).join(",")}`);
// 保存 keypairs 供 Part 2 使用
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("/tmp/squads-rehearsal/keys", { recursive: true });
writeFileSync("/tmp/squads-rehearsal/keys/payer.json", JSON.stringify(Array.from(payer.secretKey)));
members.forEach((m, i) => writeFileSync(`/tmp/squads-rehearsal/keys/member${i + 1}.json`, JSON.stringify(Array.from(m.secretKey))));
console.log("keypairs saved to /tmp/squads-rehearsal/keys/");
