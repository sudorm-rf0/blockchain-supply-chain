// devnet Squads 3-of-5 治理投票测试：创建测试多签（本地临时成员）→ 提案转账 → 3 票 → 执行
// 目的：验证 Squads 提案/投票/执行机制真实可用（上线后管理操作都走这条路）。
// 用法：RPC=https://api.devnet.solana.com node scripts/multisig-rehearsal/devnet-governance-test.mjs
// 注意：成员为本地临时 keypair（测试专用，非项目成员）；payer 需有 devnet SOL。
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { rpc, types, getMultisigPda, getVaultPda, accounts, PROGRAM_ADDRESS } from "@sqds/multisig";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const programId = new PublicKey(PROGRAM_ADDRESS);
const THRESHOLD = 3;
const TARGET = new PublicKey("3xrRyw1xnGjaEYmCdFTARt8xVeKcZPUmarJRTwyJ4k8t"); // 转回 payer 便于核对
const AMOUNT = LAMPORTS_PER_SOL / 1000; // 0.001 SOL

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 每条交易先确认再进入下一步，避免 devnet 确认延迟导致的状态竞争
async function sendAndConfirm(label, sender, fn) {
  const sig = await fn();
  await conn.confirmTransaction(sig, "confirmed");
  await sleep(1500); // 给索引器/RPC 状态同步留出余量（devnet 常见抖动）
  console.log(`✅ ${label}: ${sig}`);
  return sig;
}

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));
console.log("payer:", payer.publicKey.toBase58(), "balance:", (await conn.getBalance(payer.publicKey)) / 1e9, "SOL");
// 测试多签使用独立 createKey（与真实成员多签 2NJfQrv4... 区分开）。
// 每次运行创建全新测试多签（devnet 测试网，避免 transaction index 撞车）。
const createKey = Keypair.generate();
console.log("测试 createKey:", createKey.publicKey.toBase58());

// 5 个临时成员
const members = Array.from({ length: 5 }, () => Keypair.generate());
console.log("临时成员（测试用）:");
members.forEach((m, i) => console.log(`  m${i + 1}: ${m.publicKey.toBase58()}`));

// 给成员转账（airdrop 已干涸，用 payer 转）
for (const m of members) {
  await sendAndConfirm(`给成员 ${m.publicKey.toBase58().slice(0, 8)} 转 0.01 SOL`, "fund", async () => {
    const tx = new VersionedTransaction(new TransactionMessage({
      payerKey: payer.publicKey, recentBlockhash: (await conn.getLatestBlockhash()).blockhash,
      instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: m.publicKey, lamports: LAMPORTS_PER_SOL / 100 })],
    }).compileToV0Message());
    tx.sign([payer]);
    return conn.sendTransaction(tx);
  });
}

// 创建测试多签（幂等）
const [multisigPda] = getMultisigPda({ createKey: createKey.publicKey });
console.log("测试多签 PDA:", multisigPda.toBase58());
let ms = await accounts.Multisig.fromAccountAddress(conn, multisigPda).catch(() => null);
if (!ms) {
  await sendAndConfirm("测试多签创建", "create", async () => {
    const [cfg] = (await import("@sqds/multisig")).getProgramConfigPda({ programId });
    const cfgAcc = await conn.getAccountInfo(cfg);
    const treasury = new PublicKey(cfgAcc.data.subarray(8, 40));
    return rpc.multisigCreateV2({
      connection: conn, treasury, createKey, creator: payer, multisigPda,
      configAuthority: null, threshold: THRESHOLD,
      members: members.map((m) => ({ key: m.publicKey, permissions: types.Permissions.all() })),
      timeLock: 0, rentCollector: null, sendOptions: { skipPreflight: false }, programId,
    });
  });
  ms = await accounts.Multisig.fromAccountAddress(conn, multisigPda);
} else {
  console.log("测试多签已存在（幂等），threshold:", ms.threshold);
}
console.log("多签 transaction_index（链上为准）:", ms.transactionIndex.toString(), "stale:", ms.staleTransactionIndex.toString());

// vault（index 0）注资
const [vaultPda] = getVaultPda({ multisigPda, index: 0 });
console.log("vault:", vaultPda.toBase58());
let vbal = await conn.getBalance(vaultPda);
if (vbal < AMOUNT + 1e7) {
  await sendAndConfirm("vault 注资", "fund", async () => {
    const tx = new VersionedTransaction(new TransactionMessage({
      payerKey: payer.publicKey, recentBlockhash: (await conn.getLatestBlockhash()).blockhash,
      instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: vaultPda, lamports: AMOUNT + 1e7 })],
    }).compileToV0Message());
    tx.sign([payer]);
    return conn.sendTransaction(tx);
  });
  vbal = await conn.getBalance(vaultPda);
}
console.log("vault 余额:", vbal / 1e9, "SOL");

// Squads V4：新建多签 transaction_index=0，第一条 vault 交易使用 index 1（链上 `+1` 规则）。
// @sqds 2.1.4 解析器对 transaction_index 偏移读到 0 属已知问题，以链上为准。
let txIndex = BigInt(ms.transactionIndex.toString()) + 1n;
console.log("将创建 vault 交易 index:", txIndex.toString());

// 发起 vault 交易：vault → TARGET 转 AMOUNT
const transferMsg = new TransactionMessage({
  payerKey: vaultPda,
  recentBlockhash: (await conn.getLatestBlockhash()).blockhash,
  instructions: [SystemProgram.transfer({ fromPubkey: vaultPda, toPubkey: TARGET, lamports: AMOUNT })],
}); // 未编译，@sqds 内部会再编译
await sendAndConfirm(`vaultTransactionCreate (index ${txIndex})`, "create", async () =>
  rpc.vaultTransactionCreate({
    connection: conn, feePayer: members[0], multisigPda, transactionIndex: txIndex, creator: members[0].publicKey,
    rentPayer: members[0].publicKey, vaultIndex: 0, ephemeralSigners: [], transactionMessage: transferMsg,
    addressLookupTableAccounts: [], sendOptions: { skipPreflight: false }, programId,
  })
);

// 创建提案（非 draft，直接 Active）
await sendAndConfirm("proposalCreate", "create", async () =>
  rpc.proposalCreate({ connection: conn, feePayer: members[0], creator: members[0], rentPayer: members[0], multisigPda, transactionIndex: txIndex, isDraft: false, sendOptions: { skipPreflight: false }, programId })
);
console.log("✅ proposalCreate（isDraft=false，提案直接进入 Active 状态，无需 activate）");

// 3 票通过（m1/m2/m3）
for (const m of members.slice(0, THRESHOLD)) {
  await sendAndConfirm(`成员 ${m.publicKey.toBase58().slice(0, 8)} approve`, "approve", async () =>
    rpc.proposalApprove({ connection: conn, feePayer: m, member: m, multisigPda, transactionIndex: txIndex, sendOptions: { skipPreflight: false }, programId })
  );
}

// 执行（m4）
const before = await conn.getBalance(TARGET);
await sendAndConfirm("vaultTransactionExecute", "execute", async () =>
  rpc.vaultTransactionExecute({ connection: conn, multisigPda, transactionIndex: txIndex, member: members[3].publicKey, feePayer: members[3], sendOptions: { skipPreflight: false }, programId })
);
await sleep(3000);
const after = await conn.getBalance(TARGET);
console.log("TARGET 余额 before:", before / 1e9, "after:", after / 1e9, "SOL");
const ok = after - before === AMOUNT;
console.log(ok ? "🎉 治理测试通过：3-of-5 提案 → 投票 → 多签执行转账成功" : "❌ 执行金额不符");
console.log("=== OUTPUT ===");
console.log(`GOV_TEST_MULTISIG=${multisigPda.toBase58()}`);
console.log(`GOV_TEST_VAULT=${vaultPda.toBase58()}`);
console.log(`GOV_TEST_TRANSFER_AMOUNT_SOL=${AMOUNT / 1e9}`);
console.log(`GOV_TEST_RESULT=${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
