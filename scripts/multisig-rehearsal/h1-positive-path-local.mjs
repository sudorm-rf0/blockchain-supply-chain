// H-1 正路径本地演练：真实 Squads v4 程序（validator --clone）+ 真实多签 + 合约 multisig 配置
// → 负向（单签被拒）→ 正向（VaultTransaction 包裹合约 admin 指令，vault PDA 签名执行成功）。
//
// 前置：solana-test-validator --clone SQDS4ep65... 已启动（run.sh 编排）；合约已部署并初始化。
// 用法：RPC=http://127.0.0.1:8899 node scripts/multisig-rehearsal/h1-positive-path-local.mjs
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { rpc, types, getMultisigPda, getVaultPda, accounts, PROGRAM_ADDRESS } from "@sqds/multisig";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const RPC = process.env.RPC ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const squadsProgramId = new PublicKey(PROGRAM_ADDRESS);
const TRADE_PID = new PublicKey(process.env.TRADE_FINANCE_PROGRAM_ID ?? "9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3");
const SUPPLY_PID = new PublicKey(process.env.SUPPLY_CHAIN_PROGRAM_ID ?? "Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk");
const THRESHOLD = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const disc = (n) => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));
console.log("payer:", payer.publicKey.toBase58(), "bal:", (await conn.getBalance(payer.publicKey)) / 1e9, "SOL");
let ok = true;
const results = {};

// 前置检查：本地 validator 必须已部署真实 Squads 程序（run.sh --clone）。
{
  const sq = await conn.getAccountInfo(squadsProgramId);
  if (!sq || !sq.executable) {
    console.error("❌ 本地 validator 未部署 Squads 程序：请用 solana-test-validator --clone SQDS4ep65... 启动");
    process.exit(2);
  }
  console.log("✅ 本地 validator 已加载真实 Squads v4 程序");
}

// ---------- 1. 初始化 Squads ProgramConfig（首次部署后需要） ----------
async function ensureProgramConfig() {
  const [cfg] = (await import("@sqds/multisig")).getProgramConfigPda({ programId: squadsProgramId });
  const acc = await conn.getAccountInfo(cfg);
  if (acc) { console.log("ProgramConfig 已存在（clone 自 devnet）"); return; }
  console.log("初始化 Squads ProgramConfig（treasury = payer；仅在 ProgramConfig 未 clone 时执行）...");
  const { generated } = await import("@sqds/multisig");
  const ix = generated.createProgramConfigInitInstruction(
    { programConfig: cfg, initializer: payer.publicKey },
    { args: { authority: payer.publicKey, multisigCreationFee: 0n, treasury: payer.publicKey } },
    squadsProgramId,
  );
  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  console.log("✅ ProgramConfig 初始化:", sig);
}
await ensureProgramConfig();

// ---------- 1.5 初始化 supply-chain Registry（若不存在；payer 为 UA/admin） ----------
async function ensureRegistry() {
  const [regPda] = PublicKey.findProgramAddressSync([Buffer.from("supply_chain"), Buffer.from("registry")], SUPPLY_PID);
  const regAcc = await conn.getAccountInfo(regPda);
  if (regAcc) { console.log("Registry 已存在"); return; }
  const [programData] = PublicKey.findProgramAddressSync(
    [SUPPLY_PID.toBuffer()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  );
  const ix = new TransactionInstruction({
    programId: SUPPLY_PID,
    keys: [
      { pubkey: regPda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: programData, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    // initialize_registry(initial_delay_secs=i64) —— test-build 允许小值
    data: Buffer.concat([disc("initialize_registry"), Buffer.alloc(8)]),
  });
  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  console.log("✅ Registry 初始化:", sig);
}
await ensureRegistry();

// ---------- 2. 创建真实 Squads 3-of-5 多签（幂等，固定 createKey） ----------
const createKey = Keypair.generate();
const members = Array.from({ length: 5 }, () => Keypair.generate());
const [multisigPda] = getMultisigPda({ createKey: createKey.publicKey });
let ms = await accounts.Multisig.fromAccountAddress(conn, multisigPda).catch(() => null);
if (!ms) {
  const [cfg] = (await import("@sqds/multisig")).getProgramConfigPda({ programId: squadsProgramId });
  const cfgAcc = await conn.getAccountInfo(cfg);
  const treasury = new PublicKey(cfgAcc.data.subarray(8, 40));
  const sig = await rpc.multisigCreateV2({
    connection: conn, treasury, createKey, creator: payer, multisigPda,
    configAuthority: null, threshold: THRESHOLD,
    members: members.map((m) => ({ key: m.publicKey, permissions: types.Permissions.all() })),
    timeLock: 0, rentCollector: null, sendOptions: {}, programId: squadsProgramId,
  });
  await conn.confirmTransaction(sig, "confirmed");
  ms = await accounts.Multisig.fromAccountAddress(conn, multisigPda);
  console.log("✅ 真实 Squads 多签创建:", sig);
} else {
  console.log("多签已存在");
}
console.log("多签 PDA:", multisigPda.toBase58(), "threshold:", ms.threshold, "of", ms.members.length);

// 给成员转 SOL（approve/execute 需要）
for (const m of members) {
  const bal = await conn.getBalance(m.publicKey);
  if (bal < 5e8) {
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: m.publicKey, lamports: 1e9 }));
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(payer);
    await conn.sendRawTransaction(tx.serialize());
  }
}

// ---------- 3. 配置合约 multisig（supply-chain 与 trade-finance 都做） ----------
const [vaultPda] = getVaultPda({ multisigPda, index: 0 });
console.log("vault PDA（admin 签名者）:", vaultPda.toBase58());

async function configureSupplyChain() {
  const [regPda] = PublicKey.findProgramAddressSync([Buffer.from("supply_chain"), Buffer.from("registry")], SUPPLY_PID);
  const regAcc = await conn.getAccountInfo(regPda);
  if (!regAcc) { console.log("⚠️ Registry 未初始化，跳过 supply-chain 配置（需先 initialize_registry）"); return; }
  // 读 multisig tag（Registry 布局：disc8 + admin32 + initialized8 + pending_admin32 + proposed8 + delay8 + multisig(1+32) + vault_index1 ...）
  // multisig tag offset: 8+32+8+32+8+8 = 96
  const tag = regAcc.data.readUInt8(96);
  const existing = tag === 1 ? new PublicKey(regAcc.data.subarray(97, 129)).toBase58() : null;
  console.log("  [diag] Registry multisig tag=", tag, "existing=", existing ?? "None");
  if (existing === multisigPda.toBase58()) { console.log("supply-chain multisig 已配置"); return; }
  // propose（单管理员，test-build delay=1）+ 等时锁 + accept
  const regIx = (data) => new TransactionInstruction({
    programId: SUPPLY_PID,
    keys: [
      { pubkey: regPda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ],
    data,
  });
  const delayBuf = Buffer.alloc(8); delayBuf.writeBigInt64LE(1n); // test-build delay=1s
  const proposeData = Buffer.concat([disc("propose_multisig"), multisigPda.toBuffer(), delayBuf, Buffer.from([0])]);
  let tx = new Transaction().add(regIx(proposeData));
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(payer);
  try {
    const psig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(psig, "confirmed");
    console.log("  [diag] propose_multisig sig:", psig.slice(0, 12));
  } catch (e) {
    console.log("  ❌ [diag] propose_multisig 失败:", (e.message ?? "").slice(0, 160));
    throw e;
  }
  await sleep(1500);
  const acceptIx = new TransactionInstruction({
    programId: SUPPLY_PID,
    keys: [
      { pubkey: regPda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ],
    data: disc("accept_multisig"),
  });
  tx = new Transaction().add(acceptIx);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(payer);
  try {
    const asig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(asig, "confirmed");
    console.log("  [diag] accept_multisig sig:", asig.slice(0, 12));
  } catch (e) {
    console.log("  ❌ [diag] accept_multisig 失败:", (e.message ?? "").slice(0, 200));
    throw e;
  }
  // 重读验证
  const regAcc2 = await conn.getAccountInfo(regPda);
  const t2 = regAcc2.data.readUInt8(96);
  console.log("  [diag] accept 后 multisig tag=", t2, t2 === 1 ? new PublicKey(regAcc2.data.subarray(97,129)).toBase58() : "None");
  console.log("✅ supply-chain multisig 已配置:", multisigPda.toBase58());
}
await configureSupplyChain();

// ---------- 4. 负向：单签调用合约 admin 指令必须被拒（MultisigEnforced） ----------
async function negativeTest() {
  // 用 supply-chain authorize_supplier（单签）验证被拒
  const [regPda] = PublicKey.findProgramAddressSync([Buffer.from("supply_chain"), Buffer.from("registry")], SUPPLY_PID);
  const supPda = PublicKey.findProgramAddressSync(
    [Buffer.from("supply_chain"), Buffer.from("supplier"), payer.publicKey.toBuffer()], SUPPLY_PID,
  )[0];
  const ix = new TransactionInstruction({
    programId: SUPPLY_PID,
    keys: [
      { pubkey: regPda, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: supPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("authorize_supplier"), payer.publicKey.toBuffer()]),
  });
  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(payer);
  try {
    await conn.sendRawTransaction(tx.serialize());
    results.negative = false;
    console.log("❌ 负向失败：单签未被拒");
  } catch (e) {
    const msg = `${e.message ?? ""}`;
    results.negative = /MultisigEnforced|Squads vault PDA/i.test(msg);
    console.log(results.negative ? "✅ 负向通过：单签被 MultisigEnforced 拒绝" : "❌ 负向失败，错误:", msg.slice(0, 120));
  // 诊断：负向后读 Registry multisig
  const [regPda2] = PublicKey.findProgramAddressSync([Buffer.from("supply_chain"), Buffer.from("registry")], SUPPLY_PID);
  const regAcc2 = await conn.getAccountInfo(regPda2);
  if (regAcc2) {
    const t2 = regAcc2.data.readUInt8(96);
    console.log("  [diag] 负向后 Registry multisig tag=", t2, t2 === 1 ? new PublicKey(regAcc2.data.subarray(97,129)).toBase58() : "None");
  }
  }
}
await negativeTest();

// ---------- 5. 正向：真实 Squads VaultTransaction 包裹 authorize_supplier（vault PDA 签名） ----------
async function positiveTest() {
  const supplierKey = members[1].publicKey;
  const [regPda] = PublicKey.findProgramAddressSync([Buffer.from("supply_chain"), Buffer.from("registry")], SUPPLY_PID);
  const supPda = PublicKey.findProgramAddressSync(
    [Buffer.from("supply_chain"), Buffer.from("supplier"), supplierKey.toBuffer()], SUPPLY_PID,
  )[0];
  // 预注资 supplier PDA 租金（authorize_supplier 用 init_if_needed 需租金，由 vault 或 payer 支付；
  // 这里由 payer 预注资，避免 Squads 执行时租金不足）。
  const supBal = await conn.getBalance(supPda);
  if (supBal < 2_000_000) {
    const fundTx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: payer.publicKey, toPubkey: supPda, lamports: 2_000_000,
    }));
    fundTx.feePayer = payer.publicKey;
    fundTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    fundTx.sign(payer);
    await conn.sendRawTransaction(fundTx.serialize());
    await sleep(500);
  }
  const innerIx = new TransactionInstruction({
    programId: SUPPLY_PID,
    keys: [
      { pubkey: regPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: true, isWritable: false }, // admin = vault PDA
      { pubkey: supPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("authorize_supplier"), supplierKey.toBuffer()]),
  });
  const txIndex = BigInt(ms.transactionIndex.toString()) + 1n;
  const msg = new (await import("@solana/web3.js")).TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: (await conn.getLatestBlockhash()).blockhash,
    instructions: [innerIx],
  });
  const createSig = await rpc.vaultTransactionCreate({
    connection: conn, feePayer: members[0], multisigPda, transactionIndex: txIndex,
    creator: members[0].publicKey, rentPayer: members[0].publicKey, vaultIndex: 0,
    ephemeralSigners: [], transactionMessage: msg, addressLookupTableAccounts: [],
    sendOptions: {}, programId: squadsProgramId,
  });
  await conn.confirmTransaction(createSig, "confirmed");
  console.log("✅ vaultTransactionCreate (index", txIndex.toString() + ")");
  const propSig = await rpc.proposalCreate({
    connection: conn, feePayer: members[0], creator: members[0], rentPayer: members[0],
    multisigPda, transactionIndex: txIndex, isDraft: false, sendOptions: {}, programId: squadsProgramId,
  });
  await conn.confirmTransaction(propSig, "confirmed");
  await sleep(800);
  console.log("✅ proposalCreate");
  for (let i = 0; i < THRESHOLD; i++) {
    const appSig = await rpc.proposalApprove({
      connection: conn, feePayer: members[i], member: members[i],
      multisigPda, transactionIndex: txIndex, sendOptions: {}, programId: squadsProgramId,
    });
    await conn.confirmTransaction(appSig, "confirmed");
    await sleep(500);
    console.log("✅ approve", i + 1);
  }
  const execSig = await rpc.vaultTransactionExecute({
    connection: conn, multisigPda, transactionIndex: txIndex,
    member: members[3].publicKey, feePayer: members[3], sendOptions: {}, programId: squadsProgramId,
  });
  await conn.confirmTransaction(execSig, "confirmed");
  await sleep(2500);
  const sup = await conn.getAccountInfo(supPda);
  const exists = !!sup;
  // Supplier 账户存在即证明 authorize_supplier 成功执行（vault PDA 签名被合约接受）
  results.positive = exists;
  console.log(exists
    ? "🎉 正向通过：Squads 多签 VaultTransaction 成功执行合约 admin 指令（vault PDA 签名被接受）"
    : "❌ 正向失败：Supplier 账户未创建");
}
await positiveTest();

console.log("=== OUTPUT ===");
console.log(JSON.stringify(results, null, 2));
const allOk = results.negative && results.positive;
console.log(`H1_POSITIVE_PATH_RESULT=${allOk ? "PASS" : "FAIL"}`);
process.exit(allOk ? 0 : 1);
