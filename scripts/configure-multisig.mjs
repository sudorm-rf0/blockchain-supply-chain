#!/usr/bin/env node
// 配置 Squads 多签为合约管理员（H-1 强制），消除出厂单管理员。
// 两步时锁：先 propose，时锁结束后 accept。accept 之后单签即失效，所有 admin 指令须由 Squads vault PDA 签名。
//
// 前置：
//   - 合约已 deploy 且 initialize_pool / initialize_registry 已完成（当前 DEPLOY_WALLET 为单管理员）
//   - 已 anchor build，存在 packages/contracts/target/idl/{trade_finance,supply_chain}.json
//   - 已安装依赖：@coral-xyz/anchor @solana/web3.js
//
// 用法：
//   第一步（提出）：  MULTISIG_ADMIN=<Squads 多签 PDA> [MULTISIG_DELAY=86400] [MULTISIG_VAULT_INDEX=0] node scripts/configure-multisig.mjs
//   第二步（接受）：  node scripts/configure-multisig.mjs --accept
//
// 注意：MULTISIG_ADMIN 必须是真实存在的 Squads v4 多签账户 PDA；vault 索引须与
//       contracts 中 SQUADS_VAULT_INDEX / multisig_vault_index（默认 0）一致。
import { readFileSync } from "node:fs";
import path from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";

const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const CONTRACTS = process.env.CONTRACTS_DIR || "packages/contracts";
const TRADE = process.env.TRADE_FINANCE_PROGRAM_ID;
const SUPPLY = process.env.SUPPLY_CHAIN_PROGRAM_ID;
const MS = process.env.MULTISIG_ADMIN;
const DELAY = process.env.MULTISIG_DELAY ? Number(process.env.MULTISIG_DELAY) : 86400;
const VAULT_INDEX = process.env.MULTISIG_VAULT_INDEX ? Number(process.env.MULTISIG_VAULT_INDEX) : 0;
const ACCEPT = process.argv.includes("--accept");

function fail(msg) { console.error("CONFIGURE-MULTISIG FAIL:", msg); process.exit(1); }
if (!TRADE || !SUPPLY) fail("TRADE_FINANCE_PROGRAM_ID / SUPPLY_CHAIN_PROGRAM_ID 必须设置");
if (!ACCEPT && !MS) fail("第一步须设置 MULTISIG_ADMIN=<Squads 多签 PDA>");

const kpPath = process.env.DEPLOYER_KEYPAIR_PATH
  || path.join(process.env.HOME || "", ".config/solana/id.json");
let kp;
try { kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(kpPath, "utf8")))); }
catch (e) { fail(`无法加载部署者密钥 ${kpPath}: ${e.message}`); }

const conn = new Connection(RPC, "confirmed");
const wallet = new Wallet(kp);
const provider = new AnchorProvider(conn, wallet, { commitment: "confirmed" });

function loadIdl(name) {
  try { return JSON.parse(readFileSync(`${CONTRACTS}/target/idl/${name}.json`, "utf8")); }
  catch (e) { fail(`无法加载 IDL ${CONTRACTS}/target/idl/${name}.json（请先 anchor build）: ${e.message}`); }
}
const tradeProg = new Program({ ...loadIdl("trade_finance"), address: new PublicKey(TRADE) }, provider);
const supplyProg = new Program({ ...loadIdl("supply_chain"), address: new PublicKey(SUPPLY) }, provider);
const [poolPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("trade_finance"), Buffer.from("trade_pool")], tradeProg.programId,
);
const [regPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("supply_chain"), Buffer.from("registry")], supplyProg.programId,
);

async function main() {
  if (!ACCEPT) {
    await tradeProg.methods
      .proposeMultisig(new PublicKey(MS), new BN(DELAY), VAULT_INDEX)
      .accounts({ poolState: poolPda, admin: kp.publicKey })
      .rpc();
    await supplyProg.methods
      .proposeMultisig(new PublicKey(MS), new BN(DELAY), VAULT_INDEX)
      .accounts({ registry: regPda, admin: kp.publicKey })
      .rpc();
    console.log(`propose_multisig 已提出：multisig=${MS} delay=${DELAY}s vaultIndex=${VAULT_INDEX}`);
    console.log(`请在时锁（>= ${DELAY}s）结束后运行：node scripts/configure-multisig.mjs --accept`);
  } else {
    await tradeProg.methods
      .acceptMultisig()
      .accounts({ poolState: poolPda, admin: kp.publicKey })
      .rpc();
    await supplyProg.methods
      .acceptMultisig()
      .accounts({ registry: regPda, admin: kp.publicKey })
      .rpc();
    console.log("accept_multisig 完成。PoolState/Registry.multisig 已配置，单签已失效。");
    console.log("下一步：运行 bash scripts/precheck-mainnet-deploy.sh 验证 on-chain multisig enforced = PASS");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
