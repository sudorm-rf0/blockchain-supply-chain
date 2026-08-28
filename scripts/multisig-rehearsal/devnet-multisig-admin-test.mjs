// devnet 正路径验证（审计第 6 轮 H-1 放行前置 ②）：
//   真实 Squads 多签 → VaultTransaction 包裹合约 admin 指令 → 3/5 批准 → 执行 → 断言成功。
// 这是对"check_authority(admin==Squads vault PDA)"的端到端正向证明：
//   只有 Squads 程序在已批准 VaultTransaction 执行时才以内层 CPI 用 vault PDA 签名，
//   因此 admin 签名者==vault PDA 即证明"经多签批准"。
//
// 前置条件（devnet）：
//   1) 新版合约（含 multisig 字段）已部署到 devnet，USDC/LP mint 已初始化、池已 initialize；
//   2) 合约 pool_state.multisig 已通过 propose_multisig+accept_multisig 配置为本测试多签；
//   3) devnet 网络可用（2026-08-09 曾因 blockhash 服务滞后故障）。
//
// 用法：
//   RPC=https://api.devnet.solana.com \
//   TRADE_FINANCE_PROGRAM_ID=<新版程序ID> USDC_MINT=<mint> LP_MINT=<mint> \
//   ADMIN_KP=~/.config/solana/id.json \
//   node scripts/multisig-rehearsal/devnet-multisig-admin-test.mjs
import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { rpc, types, getMultisigPda, getVaultPda, accounts, PROGRAM_ADDRESS } from "@sqds/multisig";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const programId = new PublicKey(PROGRAM_ADDRESS);
const TRADE_PID = new PublicKey(process.env.TRADE_FINANCE_PROGRAM_ID);
const THRESHOLD = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KP ?? `${homedir()}/.config/solana/id.json`, "utf8"))),
);
console.log("admin(payer):", admin.publicKey.toBase58(), "bal:", (await conn.getBalance(admin.publicKey)) / 1e9, "SOL");

// 幂等：测试多签用固定 createKey（管理员派生），避免每次重建
const createKey = admin;
const [multisigPda] = getMultisigPda({ createKey: createKey.publicKey });
console.log("multisig PDA:", multisigPda.toBase58());

// 5 个成员：本地临时 keypair（真实 Squads 程序 + 真实 3/5 阈值；approve 需要私钥，
// 真实钱包地址无法在自动化脚本中签名，故用临时成员——多签创建/批准/执行均为真实链上流程）。
const tempMembers = Array.from({ length: 5 }, () => Keypair.generate());
const members = tempMembers.map((m) => m.publicKey);
console.log("成员:", members.map((k) => k.toBase58().slice(0, 8)).join(", "));

// 1) 创建/复用测试多签
const [cfg] = (await import("@sqds/multisig")).getProgramConfigPda({ programId });
const cfgAcc = await conn.getAccountInfo(cfg);
const treasury = new PublicKey(cfgAcc.data.subarray(8, 40));
let ms = await accounts.Multisig.fromAccountAddress(conn, multisigPda).catch(() => null);
if (!ms) {
  const sig = await rpc.multisigCreateV2({
    connection: conn, treasury, createKey: createKey, creator: admin, multisigPda,
    configAuthority: null, threshold: THRESHOLD,
    members: members.map((k) => ({ key: k, permissions: types.Permissions.all() })),
    timeLock: 0, rentCollector: null, sendOptions: {}, programId,
  });
  await conn.confirmTransaction(sig, "confirmed");
  ms = await accounts.Multisig.fromAccountAddress(conn, multisigPda);
  console.log("✅ 多签创建:", sig);
} else {
  console.log("多签已存在, threshold:", ms.threshold, "members:", ms.members.length);
}
console.log("multisig txIndex:", ms.transactionIndex.toString());

// 2) 合约池：读取当前 multisig 配置
const [poolState] = PublicKey.findProgramAddressSync(
  [Buffer.from("trade_finance"), Buffer.from("trade_pool")], TRADE_PID,
);
const poolAcc = await conn.getAccountInfo(poolState);
if (!poolAcc) { console.error("❌ 合约池不存在（先 initialize_pool）"); process.exit(2); }
// 解析 multisig 字段（尾部）：disc8 + admin32 + ... 需按新版布局
// 直接读 tail：multisig tag 在 (8+32+8*? ) 之后 —— 用 485 布局定位
// multisig tag offset = 8+32+8+8+8+8+8+32+8+1+32+32+8+8+8+8+32+8+8+8+8+8+8+8+8+8+8+1+8+32+32 = 402
const MS_TAG_OFF = 402;
const msTag = poolAcc.data.readUInt8(MS_TAG_OFF);
console.log("pool multisig tag:", msTag, "(1=已配置, 0=未配置)");
if (msTag !== 1) {
  console.error("❌ 池未配置 multisig —— 请先由当前 admin 跑 propose_multisig+accept_multisig 指向", multisigPda.toBase58());
  process.exit(2);
}
const poolMultisig = new PublicKey(poolAcc.data.subarray(MS_TAG_OFF + 1, MS_TAG_OFF + 1 + 32));
console.log("池配置的 multisig:", poolMultisig.toBase58());
if (poolMultisig.toBase58() !== multisigPda.toBase58()) {
  console.error("❌ 池 multisig 与测试多签不一致"); process.exit(2);
}

// 3) vault PDA（合约校验 admin==vault）
const [vaultPda] = getVaultPda({ multisigPda, index: 0 });
console.log("vault PDA (admin 签名者):", vaultPda.toBase58());

// 4) 构建 VaultTransaction：包裹合约 set_paused(false)（admin=vault PDA）
//    Squads 执行时以 vault PDA 作 CPI 签名者调用合约，check_authority 放行。
// set_paused 指令数据：disc(8) + bool(1)
const setPausedDisc = createHash("sha256").update("global:set_paused").digest().subarray(0, 8);
const setPausedIx = new TransactionInstruction({
  programId: TRADE_PID,
  keys: [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: true, isWritable: false }, // admin = vault PDA
  ],
  data: Buffer.concat([setPausedDisc, Buffer.from([0])]),
});
const msg = new TransactionMessage({
  payerKey: vaultPda,
  recentBlockhash: (await conn.getLatestBlockhash()).blockhash,
  instructions: [setPausedIx],
});
const txIndex = BigInt(ms.transactionIndex.toString()) + 1n;
const createSig = await rpc.vaultTransactionCreate({
  connection: conn, feePayer: members[0], multisigPda, transactionIndex: txIndex,
  creator: members[0], rentPayer: members[0], vaultIndex: 0, ephemeralSigners: [],
  transactionMessage: msg, addressLookupTableAccounts: [], sendOptions: {}, programId,
});
await conn.confirmTransaction(createSig, "confirmed");
console.log("✅ vaultTransactionCreate (index", txIndex.toString() + "):", createSig);

// 5) 提案 + 3/5 批准 + 执行
await rpc.proposalCreate({ connection: conn, feePayer: members[0], creator: members[0], rentPayer: members[0], multisigPda, transactionIndex: txIndex, isDraft: false, sendOptions: {}, programId });
console.log("✅ proposalCreate");
for (let i = 0; i < THRESHOLD; i++) {
  const signer = tempMembers[i];
  await rpc.proposalApprove({ connection: conn, feePayer: signer, member: signer, multisigPda, transactionIndex: txIndex, sendOptions: {}, programId });
  console.log("✅ approve", i + 1);
}

// 6) 执行前：记录池 paused 状态（读 offset 120）
const pausedBefore = poolAcc.data.readUInt8(120) === 1;
const execMember = tempMembers[3];
await rpc.vaultTransactionExecute({ connection: conn, multisigPda, transactionIndex: txIndex, member: execMember.publicKey, feePayer: execMember, sendOptions: {}, programId });
await sleep(3000);
const poolAfter = await conn.getAccountInfo(poolState);
const pausedAfter = poolAfter.data.readUInt8(120) === 1;
console.log("paused before:", pausedBefore, "after:", pausedAfter);
const ok = pausedAfter === false; // set_paused(false) 成功 → paused=false
console.log(ok ? "🎉 正路径通过：Squads 多签 VaultTransaction 成功执行合约 admin 指令（set_paused）" : "❌ 正路径失败");
console.log("=== OUTPUT ===");
console.log(`MS_ADMIN_TEST_RESULT=${ok ? "PASS" : "FAIL"}`);
console.log(`MS_ADMIN_TEST_MULTISIG=${multisigPda.toBase58()}`);
console.log(`MS_ADMIN_TEST_VAULT_PDA=${vaultPda.toBase58()}`);
console.log(`MS_ADMIN_TEST_TX_INDEX=${txIndex.toString()}`);
process.exit(ok ? 0 : 1);
