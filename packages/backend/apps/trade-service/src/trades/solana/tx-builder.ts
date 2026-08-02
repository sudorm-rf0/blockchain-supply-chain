import { createHash, randomBytes } from "node:crypto";
import {
  AccountMeta,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
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

let _programIdCache: PublicKey | undefined;
let _usdcMintCache: PublicKey | undefined;
let _lpMintCache: PublicKey | undefined;

function programId(): PublicKey {
  return (_programIdCache ??= new PublicKey(TRADE_ENV.programId));
}
function usdcMintKey(): PublicKey {
  return (_usdcMintCache ??= new PublicKey(TRADE_ENV.usdcMint));
}
function lpMintKey(): PublicKey {
  if (!TRADE_ENV.lpMint) throw new Error("LP_MINT env var is required for fund/repay transactions");
  return (_lpMintCache ??= new PublicKey(TRADE_ENV.lpMint));
}

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

export interface CreateDealInstructionInput {
  id: bigint;
  seller: PublicKey;
  amount: bigint;
  tenorDays: bigint;
}

export function buildCreateDealInstructionData(
  input: CreateDealInstructionInput,
): Buffer {
  const discriminator = createHash("sha256")
    .update("global:create_deal")
    .digest()
    .subarray(0, 8);

  return Buffer.concat([
    discriminator,
    encodeU64(input.id),
    input.seller.toBuffer(),
    encodeU64(input.amount),
    encodeU64(input.tenorDays),
  ]);
}

export function buildFundDealInstructionData(tradeId: bigint): Buffer {
  const discriminator = createHash("sha256")
    .update("global:fund_deal")
    .digest()
    .subarray(0, 8);
  return Buffer.concat([discriminator, encodeU64(tradeId)]);
}

export function buildAdvanceDealInstructionData(
  tradeId: bigint,
  targetStatus: number,
): Buffer {
  const discriminator = createHash("sha256")
    .update("global:advance_deal")
    .digest()
    .subarray(0, 8);
  const target = Buffer.alloc(1);
  target.writeUInt8(targetStatus);
  return Buffer.concat([discriminator, encodeU64(tradeId), target]);
}

export function buildRepayDealInstructionData(tradeId: bigint): Buffer {
  const discriminator = createHash("sha256")
    .update("global:repay_deal")
    .digest()
    .subarray(0, 8);
  return Buffer.concat([discriminator, encodeU64(tradeId)]);
}

export interface FundDealTransactionInput {
  tradeId: bigint;
  buyer: PublicKey;
  admin: PublicKey;
}

export interface AdvanceDealTransactionInput {
  tradeId: bigint;
  buyer: PublicKey;
  admin: PublicKey;
  targetStatus: number;
}

export interface RepayDealTransactionInput {
  tradeId: bigint;
  buyer: PublicKey;
  usdcMint: PublicKey;
}

const POOL_STATE_PLATFORM_WALLET_OFFSET = 80;

function parsePlatformWallet(data: Buffer): PublicKey {
  if (data.length < POOL_STATE_PLATFORM_WALLET_OFFSET + 32) {
    throw new Error("invalid PoolState buffer for platform wallet");
  }
  return new PublicKey(
    data.subarray(
      POOL_STATE_PLATFORM_WALLET_OFFSET,
      POOL_STATE_PLATFORM_WALLET_OFFSET + 32,
    ),
  );
}

export async function buildFundDealTransaction(
  input: FundDealTransactionInput,
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const prog = programId();
  const uMint = usdcMintKey();
  const poolState = derivePoolStatePda(prog);
  const poolAuthority = derivePoolAuthorityPda(prog);
  const dealPda = deriveDealPda(prog, input.buyer, input.tradeId);
  const poolTokenAccount = deriveAssociatedTokenAccount(poolAuthority, uMint);
  const dealTokenAccount = deriveAssociatedTokenAccount(dealPda, uMint);

  const keys: AccountMeta[] = [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: input.admin, isSigner: true, isWritable: true },
    { pubkey: input.buyer, isSigner: false, isWritable: false },
    { pubkey: dealPda, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
    { pubkey: dealTokenAccount, isSigner: false, isWritable: true },
    { pubkey: uMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: lpMintKey(), isSigner: false, isWritable: false },
  ];

  const data = buildFundDealInstructionData(input.tradeId);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = input.admin;
  transaction.recentBlockhash = blockhash;
  transaction.add(new TransactionInstruction({ keys, programId: prog, data }));
  return { transaction, blockhash };
}

export async function buildAdvanceDealTransaction(
  input: AdvanceDealTransactionInput,
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const prog = programId();
  const poolState = derivePoolStatePda(prog);
  const dealPda = deriveDealPda(prog, input.buyer, input.tradeId);

  const keys: AccountMeta[] = [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: input.admin, isSigner: true, isWritable: true },
    { pubkey: input.buyer, isSigner: false, isWritable: false },
    { pubkey: dealPda, isSigner: false, isWritable: true },
  ];

  const data = buildAdvanceDealInstructionData(input.tradeId, input.targetStatus);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = input.admin;
  transaction.recentBlockhash = blockhash;
  transaction.add(new TransactionInstruction({ keys, programId: prog, data }));
  return { transaction, blockhash };
}

export async function buildRepayDealTransaction(
  input: RepayDealTransactionInput,
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const prog = programId();
  const poolState = derivePoolStatePda(prog);
  const poolAuthority = derivePoolAuthorityPda(prog);
  const dealPda = deriveDealPda(prog, input.buyer, input.tradeId);
  const poolTokenAccount = deriveAssociatedTokenAccount(poolAuthority, input.usdcMint);
  const dealTokenAccount = deriveAssociatedTokenAccount(dealPda, input.usdcMint);
  const buyerTokenAccount = deriveAssociatedTokenAccount(input.buyer, input.usdcMint);

  const poolInfo = await connection.getAccountInfo(poolState, "confirmed");
  if (!poolInfo) {
    throw new Error("pool state is not initialized");
  }
  const platformWallet = parsePlatformWallet(poolInfo.data);
  const platformTokenAccount = deriveAssociatedTokenAccount(
    platformWallet,
    input.usdcMint,
  );

  const keys: AccountMeta[] = [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: input.buyer, isSigner: true, isWritable: true },
    { pubkey: dealPda, isSigner: false, isWritable: true },
    { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: platformTokenAccount, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: true },
    { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
    { pubkey: input.usdcMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: lpMintKey(), isSigner: false, isWritable: false },
  ];

  const data = buildRepayDealInstructionData(input.tradeId);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = input.buyer;
  transaction.recentBlockhash = blockhash;

  const platformAtaExists = await connection.getAccountInfo(platformTokenAccount);
  if (!platformAtaExists) {
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        input.buyer,
        platformTokenAccount,
        platformWallet,
        input.usdcMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  transaction.add(new TransactionInstruction({ keys, programId: prog, data }));
  return { transaction, blockhash };
}

export async function buildCreateDealTransaction(
  input: CreateDealTransactionInput,
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const prog = programId();
  const poolState = derivePoolStatePda(prog);
  const dealPda = deriveDealPda(prog, input.buyer, input.id);
  const dealTokenAccount = deriveAssociatedTokenAccount(dealPda, input.usdcMint);

  const data = buildCreateDealInstructionData(input);

  // Contract CreateDeal account ordering:
  // pool_state, buyer(signer), deal(init), buyer_token_account,
  // deal_token_account, usdc_mint, token_program, system_program
  const keys: AccountMeta[] = [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: input.buyer, isSigner: true, isWritable: true },
    { pubkey: dealPda, isSigner: false, isWritable: true },
    { pubkey: input.buyerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: dealTokenAccount, isSigner: false, isWritable: true },
    { pubkey: input.usdcMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = input.buyer;
  transaction.recentBlockhash = blockhash;

  // 托管 ATA（deal PDA 持有）和买方 ATA 不存在时，随交易一起创建；
  // 使用幂等指令，已存在时也无需额外 RPC 查询。
  const [buyerAtaExists, dealAtaExists] = await Promise.all([
    connection.getAccountInfo(input.buyerTokenAccount),
    connection.getAccountInfo(dealTokenAccount),
  ]);
  if (!buyerAtaExists) {
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        input.buyer,
        input.buyerTokenAccount,
        input.buyer,
        input.usdcMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }
  if (!dealAtaExists) {
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        input.buyer,
        dealTokenAccount,
        dealPda,
        input.usdcMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  transaction.add(new TransactionInstruction({ keys, programId: prog, data }));

  return { transaction, blockhash };
}

export function generateTradeId(): bigint {
  return randomBytes(8).readBigUInt64LE();
}
