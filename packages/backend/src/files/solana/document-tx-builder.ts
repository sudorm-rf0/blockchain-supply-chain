import { createHash } from "node:crypto";
import {
  AccountMeta,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const DEFAULT_PROGRAM_ID =
  "9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3";
const DOCUMENT_SEED = Buffer.from("trade_finance");
const DOCUMENT_PREFIX = Buffer.from("document");

let cachedProgramId: PublicKey | null = null;
let cachedConnection: Connection | null = null;

export function getProgramId(): PublicKey {
  cachedProgramId ??= new PublicKey(
    process.env.TRADE_FINANCE_PROGRAM_ID ?? DEFAULT_PROGRAM_ID,
  );
  return cachedProgramId;
}

export function getRpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
}

export function getConnection(): Connection {
  cachedConnection ??= new Connection(getRpcUrl(), "confirmed");
  return cachedConnection;
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

export function deriveDocumentPda(
  tradeId: bigint,
  fileHash: Buffer,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      DOCUMENT_SEED,
      DOCUMENT_PREFIX,
      encodeU64(tradeId),
      fileHash,
    ],
    getProgramId(),
  )[0];
}

export function deriveDealPda(
  buyer: PublicKey,
  tradeId: bigint,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      DOCUMENT_SEED,
      Buffer.from("deal"),
      buyer.toBuffer(),
      encodeU64(tradeId),
    ],
    getProgramId(),
  )[0];
}

export interface AttestDocumentTransactionInput {
  owner: PublicKey;
  tradeId: bigint;
  fileHash: Buffer;
  uri: string;
  dealPda?: PublicKey | null;
}

export function buildAttestDocumentInstructionData(
  input: Pick<AttestDocumentTransactionInput, "tradeId" | "fileHash" | "uri">,
): Buffer {
  if (input.fileHash.length !== 32) {
    throw new Error("file hash must be 32 bytes");
  }

  // Anchor discriminator = sha256("global:attest_document")[0..8]
  const discriminator = createHash("sha256")
    .update("global:attest_document")
    .digest()
    .subarray(0, 8);

  // Contract layout: trade_id(u64) | file_hash([u8;32]) | uri(String)
  return Buffer.concat([
    discriminator,
    encodeU64(input.tradeId),
    input.fileHash,
    encodeBorshString(input.uri),
  ]);
}

export async function buildAttestDocumentTransaction(
  input: AttestDocumentTransactionInput,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const programId = getProgramId();
  const documentPda = deriveDocumentPda(input.tradeId, input.fileHash);
  const data = buildAttestDocumentInstructionData(input);

  // AttestDocument accounts: owner(signer), document(init), deal(optional), system_program
  const keys: AccountMeta[] = [
    { pubkey: input.owner, isSigner: true, isWritable: true },
    { pubkey: documentPda, isSigner: false, isWritable: true },
  ];
  if (input.dealPda) {
    keys.push({
      pubkey: input.dealPda,
      isSigner: false,
      isWritable: false,
    });
  } else {
    keys.push({
      pubkey: programId,
      isSigner: false,
      isWritable: false,
    });
  }
  keys.push({
    pubkey: SystemProgram.programId,
    isSigner: false,
    isWritable: false,
  });

  const connection = getConnection();
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = input.owner;
  transaction.recentBlockhash = blockhash;
  transaction.add(new TransactionInstruction({ keys, programId, data }));

  return { transaction, blockhash };
}
