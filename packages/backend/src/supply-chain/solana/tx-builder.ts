import { createHash } from "node:crypto";
import { pickRpcUrl } from "@supply-chain/common";
import {
  AccountMeta,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const DEFAULT_PROGRAM_ID =
  "Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk";
const SC_SEED = Buffer.from("supply_chain");
const REGISTRY_PREFIX = Buffer.from("registry");
const SUPPLIER_PREFIX = Buffer.from("supplier");
const PRODUCT_PREFIX = Buffer.from("product");

let cachedProgramId: PublicKey | null = null;

export function getProgramId(): PublicKey {
  cachedProgramId ??= new PublicKey(
    process.env.SUPPLY_CHAIN_PROGRAM_ID ?? DEFAULT_PROGRAM_ID,
  );
  return cachedProgramId;
}

export function getRpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
}

const _rpcConnections = new Map<string, Connection>();

export function getConnection(): Connection {
  const url = pickRpcUrl(getRpcUrl());
  let conn = _rpcConnections.get(url);
  if (!conn) {
    conn = new Connection(url, {
      commitment: "confirmed",
      fetch: (fetchUrl, options) =>
        fetch(fetchUrl, { ...options, signal: AbortSignal.timeout(30_000) }),
    });
    _rpcConnections.set(url, conn);
  }
  return conn;
}

export function supplyChainDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

export function encodeU64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

export function encodeBorshString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

/** 与合约 sku_seed 一致（审计 N-04/I-05）：SKU 的完整 SHA-256 32 字节。 */
export function skuSeed(sku: string): Buffer {
  return createHash("sha256").update(sku).digest();
}

export function deriveRegistryPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SC_SEED, REGISTRY_PREFIX],
    programId,
  )[0];
}

export function deriveSupplierPda(
  programId: PublicKey,
  supplier: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SC_SEED, SUPPLIER_PREFIX, supplier.toBuffer()],
    programId,
  )[0];
}

export function deriveProductPda(
  programId: PublicKey,
  owner: PublicKey,
  sku: string,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SC_SEED, PRODUCT_PREFIX, owner.toBuffer(), skuSeed(sku)],
    programId,
  )[0];
}

async function buildTransaction(
  keys: AccountMeta[],
  data: Buffer,
  feePayer: PublicKey,
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = feePayer;
  transaction.recentBlockhash = blockhash;
  transaction.add(
    new TransactionInstruction({
      keys,
      programId: getProgramId(),
      data,
    }),
  );
  return { transaction, blockhash };
}

export function serializeTransaction(transaction: Transaction): string {
  return transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}

export function deriveProgramDataPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  )[0];
}

export async function buildInitializeRegistryTransaction(
  admin: PublicKey,
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  // 审计 H-01/N-05：initialize_registry 需要 program_data 账户校验 upgrade authority。
  const keys: AccountMeta[] = [
    { pubkey: deriveRegistryPda(getProgramId()), isSigner: false, isWritable: true },
    { pubkey: admin, isSigner: true, isWritable: true },
    { pubkey: deriveProgramDataPda(getProgramId()), isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return buildTransaction(
    keys,
    supplyChainDiscriminator("initialize_registry"),
    admin,
    connection,
  );
}

export function buildAuthorizeSupplierInstructionData(
  supplier: PublicKey,
): Buffer {
  return Buffer.concat([
    supplyChainDiscriminator("authorize_supplier"),
    supplier.toBuffer(),
  ]);
}

export async function buildAuthorizeSupplierTransaction(
  admin: PublicKey,
  supplier: PublicKey,
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const keys: AccountMeta[] = [
    { pubkey: deriveRegistryPda(getProgramId()), isSigner: false, isWritable: false },
    { pubkey: admin, isSigner: true, isWritable: true },
    {
      pubkey: deriveSupplierPda(getProgramId(), supplier),
      isSigner: false,
      isWritable: true,
    },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return buildTransaction(
    keys,
    buildAuthorizeSupplierInstructionData(supplier),
    admin,
    connection,
  );
}

export function buildRevokeSupplierInstructionData(
  supplier: PublicKey,
): Buffer {
  return Buffer.concat([
    supplyChainDiscriminator("revoke_supplier"),
    supplier.toBuffer(),
  ]);
}

export async function buildRevokeSupplierTransaction(
  admin: PublicKey,
  supplier: PublicKey,
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const keys: AccountMeta[] = [
    { pubkey: deriveRegistryPda(getProgramId()), isSigner: false, isWritable: false },
    { pubkey: admin, isSigner: true, isWritable: true },
    {
      pubkey: deriveSupplierPda(getProgramId(), supplier),
      isSigner: false,
      isWritable: true,
    },
  ];
  return buildTransaction(
    keys,
    buildRevokeSupplierInstructionData(supplier),
    admin,
    connection,
  );
}

export function buildRegisterProductInstructionData(
  sku: string,
  units: bigint,
): Buffer {
  return Buffer.concat([
    supplyChainDiscriminator("register_product"),
    encodeBorshString(sku),
    encodeU64(units),
  ]);
}

export async function buildRegisterProductTransaction(
  admin: PublicKey,
  sku: string,
  units: bigint,
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const keys: AccountMeta[] = [
    { pubkey: deriveRegistryPda(getProgramId()), isSigner: false, isWritable: false },
    {
      pubkey: deriveProductPda(getProgramId(), admin, sku),
      isSigner: false,
      isWritable: true,
    },
    { pubkey: admin, isSigner: true, isWritable: true },
    // supplier 为 None（管理员注册）：Anchor 的 Option<Account> 在传入账户 key
    // 等于 program_id 时返回 None，因此用程序自身地址占位。
    { pubkey: getProgramId(), isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return buildTransaction(
    keys,
    buildRegisterProductInstructionData(sku, units),
    admin,
    connection,
  );
}

/** 校验链上已确认交易包含预期的 supply_chain 指令。 */
export async function verifySupplyChainInstruction(
  txSignature: string,
  expectedData: Buffer,
  expectedPda?: PublicKey,
): Promise<void> {
  const connection = getConnection();
  let tx;
  try {
    tx = await connection.getTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch {
    throw new Error("交易签名无效或尚未上链");
  }
  if (!tx || tx.meta?.err) {
    throw new Error("transaction is not confirmed on chain");
  }
  const message = tx.transaction.message as {
    accountKeys?: PublicKey[];
    staticAccountKeys?: PublicKey[];
    compiledInstructions: Array<{
      programIdIndex: number;
      accountKeyIndexes: number[];
      data: Uint8Array;
    }>;
  };
  const accountKeys = message.accountKeys ?? message.staticAccountKeys ?? [];
  const programId = getProgramId();
  const hasExpected = message.compiledInstructions.some((instruction) => {
    const programMatches =
      accountKeys[instruction.programIdIndex]?.equals(programId) ?? false;
    const dataMatches =
      Buffer.compare(Buffer.from(instruction.data), expectedData) === 0;
    const pdaMatches =
      !expectedPda ||
      instruction.accountKeyIndexes.some(
        (index) => accountKeys[index]?.equals(expectedPda) ?? false,
      );
    return Boolean(programMatches && dataMatches && pdaMatches);
  });
  if (!hasExpected) {
    throw new Error("transaction does not contain the expected supply_chain instruction");
  }
}
