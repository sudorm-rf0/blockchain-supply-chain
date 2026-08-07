// 初始化 supply-chain 注册中心并授权供应商（幂等，可重复执行）。
// 运行：node scripts/init-supply-chain.mjs <供应商公钥...>
// 环境变量：
//   SOLANA_RPC_URL          默认 http://localhost:8899
//   SUPPLY_CHAIN_PROGRAM_ID 默认 Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk
//   SOLANA_KEYPAIR_PATH     默认 ~/.config/solana/id.json
//   SUPPLIERS               逗号分隔的供应商公钥（与命令行参数等价）
//
// 行为：
//   - Registry 不存在时调用 initialize_registry（管理员 = 签名钱包）。
//   - 对每个尚未授权的供应商调用 authorize_supplier。
//   - 结束时校验 Registry.admin 与每个供应商授权记录，并输出可验证结果。
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const RPC = process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
const PROGRAM_ID = new PublicKey(
  process.env.SUPPLY_CHAIN_PROGRAM_ID ?? "Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk",
);
// 程序数据账户：initialize_registry 用于校验 upgrade authority（审计 H-01/N-05）。
const PROGRAM_DATA = PublicKey.findProgramAddressSync(
  [PROGRAM_ID.toBuffer()],
  new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
)[0];
const keypairPath =
  process.env.SOLANA_KEYPAIR_PATH ??
  `${homedir()}/.config/solana/id.json`;

const supplierInput = [
  ...(process.env.SUPPLIERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  ...process.argv.slice(2),
];
const suppliers = [...new Set(supplierInput)].map((raw) => {
  try {
    return new PublicKey(raw);
  } catch {
    console.error(`invalid supplier public key: ${raw}`);
    process.exit(1);
  }
});

const conn = new Connection(RPC, "confirmed");
const secret = JSON.parse(readFileSync(keypairPath, "utf8"));
const admin = Keypair.fromSecretKey(Uint8Array.from(secret));

const registry = PublicKey.findProgramAddressSync(
  [Buffer.from("supply_chain"), Buffer.from("registry")],
  PROGRAM_ID,
)[0];
const supplierPda = (key) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("supply_chain"), Buffer.from("supplier"), key.toBuffer()],
    PROGRAM_ID,
  )[0];

const disc = (name) =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const i64 = (v) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(v));
  return b;
};
const latest = () => conn.getLatestBlockhash("confirmed");

async function sendIx(keys, data) {
  const tx = new Transaction();
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await latest()).blockhash;
  tx.add(new TransactionInstruction({ keys, programId: PROGRAM_ID, data }));
  tx.sign(admin);
  await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), "confirmed");
}

// 解析 Anchor 账户：前 8 字节 discriminator，之后首字段为 Pubkey（32 字节）。
const pubkeyField = (info) => new PublicKey(info.data.subarray(8, 40));

let registryExisted = true;
if (!(await conn.getAccountInfo(registry))) {
  registryExisted = false;
  await sendIx(
    [
      { pubkey: registry, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: PROGRAM_DATA, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    Buffer.concat([disc("initialize_registry"), i64(172_800)]), // 审计 H-06：初始 48h
  );
  console.log(`registry initialized: ${registry.toBase58()}`);
} else {
  console.log(`registry already exists: ${registry.toBase58()}`);
}

const registryInfo = await conn.getAccountInfo(registry);
if (!registryInfo) {
  console.error("registry account missing after initialization");
  process.exit(1);
}
const registryAdmin = pubkeyField(registryInfo);
if (registryAdmin.toBase58() !== admin.publicKey.toBase58()) {
  console.error(
    `registry admin mismatch: expected ${admin.publicKey.toBase58()}, got ${registryAdmin.toBase58()}`,
  );
  process.exit(1);
}
console.log(`registry admin: ${registryAdmin.toBase58()}`);

const authorized = [];
for (const supplier of suppliers) {
  const pda = supplierPda(supplier);
  if (!(await conn.getAccountInfo(pda))) {
    await sendIx(
      [
        { pubkey: registry, isSigner: false, isWritable: false },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: pda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      Buffer.concat([disc("authorize_supplier"), supplier.toBuffer()]),
    );
    console.log(`supplier authorized: ${supplier.toBase58()} -> ${pda.toBase58()}`);
  } else {
    console.log(`supplier already authorized: ${supplier.toBase58()} -> ${pda.toBase58()}`);
  }

  const info = await conn.getAccountInfo(pda);
  if (!info || pubkeyField(info).toBase58() !== supplier.toBase58()) {
    console.error(`supplier verification failed for ${supplier.toBase58()}`);
    process.exit(1);
  }
  authorized.push(supplier.toBase58());
}

console.log("--- result ---");
console.log(`SUPPLY_CHAIN_REGISTRY=${registry.toBase58()}`);
console.log(`REGISTRY_ADMIN=${registryAdmin.toBase58()}`);
console.log(`REGISTRY_INITIALIZED=${!registryExisted ? "this-run" : "pre-existing"}`);
console.log(`AUTHORIZED_SUPPLIERS=${authorized.length ? authorized.join(",") : "(none)"}`);
