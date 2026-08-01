import { createHash, randomBytes } from "node:crypto";
import {
  AccountMeta,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { TRADE_ENV } from "../../config/env";

export const BPS_BASE = 10_000n;
export const DOWN_PAYMENT_BPS = 3_000n;
export const FUNDING_PCT_BPS = 7_000n;

// 标准程序地址常量：当前 @solana/web3.js 构建未导出这些 ID。
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export function encodeU64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

const VALID_TENOR_DAYS = new Set([30n, 60n, 90n, 120n]);

export function isValidTenor(tenorDays: bigint): boolean {
  return VALID_TENOR_DAYS.has(tenorDays);
}

export function derivePoolStatePda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("trade_finance"), Buffer.from("pool")],
    programId,
  )[0];
}

export function derivePoolAuthorityPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("trade_finance"), Buffer.from("pool_usdc")],
    programId,
  )[0];
}

export function deriveDealPda(
  programId: PublicKey,
  buyer: PublicKey,
  id: bigint,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("trade_finance"),
      Buffer.from("deal"),
      buyer.toBuffer(),
      encodeU64(id),
    ],
    programId,
  )[0];
}

export function deriveAssociatedTokenAccount(
  owner: PublicKey,
  mint: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export interface CreateDealTransactionInput {
  id: bigint;
  buyer: PublicKey;
  seller: PublicKey;
  amount: bigint;
  tenorDays: bigint;
  buyerTokenAccount: PublicKey;
  usdcMint: PublicKey;
}

export async function buildCreateDealTransaction(
  input: CreateDealTransactionInput,
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const programId = new PublicKey(TRADE_ENV.programId);
  const poolState = derivePoolStatePda(programId);
  const dealPda = deriveDealPda(programId, input.buyer, input.id);

  // Anchor discriminator = sha256("global:create_deal")[0..8]
  const discriminator = createHash("sha256")
    .update("global:create_deal")
    .digest()
    .subarray(0, 8);

  // Contract layout: id(u64) | seller(Pubkey 32 bytes) | amount(u64) | tenor_days(u64)
  const data = Buffer.concat([
    discriminator,
    encodeU64(input.id),
    input.seller.toBuffer(),
    encodeU64(input.amount),
    encodeU64(input.tenorDays),
  ]);

  // Contract CreateDeal account ordering:
  // pool_state, buyer(signer), deal(init), buyer_token_account, usdc_mint, token_program, system_program
  const keys: AccountMeta[] = [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: input.buyer, isSigner: true, isWritable: true },
    { pubkey: dealPda, isSigner: false, isWritable: true },
    { pubkey: input.buyerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: input.usdcMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = input.buyer;
  transaction.recentBlockhash = blockhash;
  transaction.add(
    new TransactionInstruction({
      keys,
      programId,
      data,
    }),
  );

  return { transaction, blockhash };
}

export function generateTradeId(): bigint {
  return randomBytes(8).readBigUInt64LE();
}
