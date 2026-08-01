import { createHash } from "node:crypto";
import {
  AccountMeta,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { TRADE_ENV } from "../../config/env";
import {
  encodeU64,
  derivePoolStatePda,
  derivePoolAuthorityPda,
  deriveDealPda,
  deriveAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
} from "./tx-builder";

// Discriminators
const FUND_DEAL_DISCRIMINATOR = createHash("sha256")
  .update("global:fund_deal")
  .digest()
  .subarray(0, 8);

const REPAY_DEAL_DISCRIMINATOR = createHash("sha256")
  .update("global:repay_deal")
  .digest()
  .subarray(0, 8);

const DEPOSIT_POOL_DISCRIMINATOR = createHash("sha256")
  .update("global:deposit_pool")
  .digest()
  .subarray(0, 8);

const DEFAULT_DEAL_DISCRIMINATOR = createHash("sha256")
  .update("global:default_deal")
  .digest()
  .subarray(0, 8);

export async function buildFundDealTransaction(
  input: {
    admin: PublicKey;
    buyer: PublicKey;
    tradeId: bigint;
  },
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const programId = new PublicKey(TRADE_ENV.programId);
  const poolState = derivePoolStatePda(programId);
  const dealPda = deriveDealPda(programId, input.buyer, input.tradeId);

  // Contract: fund_deal(trade_id: u64)
  const data = Buffer.concat([FUND_DEAL_DISCRIMINATOR, encodeU64(input.tradeId)]);

  // FundDeal accounts: pool_state, admin(signer), buyer, deal, token_program
  const keys: AccountMeta[] = [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: input.admin, isSigner: true, isWritable: true },
    { pubkey: input.buyer, isSigner: false, isWritable: false },
    { pubkey: dealPda, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = input.admin;
  transaction.recentBlockhash = blockhash;
  transaction.add(new TransactionInstruction({ keys, programId, data }));

  return { transaction, blockhash };
}

export async function buildRepayDealTransaction(
  input: {
    buyer: PublicKey;
    tradeId: bigint;
    buyerTokenAccount: PublicKey;
    platformTokenAccount: PublicKey;
    usdcMint: PublicKey;
  },
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const programId = new PublicKey(TRADE_ENV.programId);
  const poolState = derivePoolStatePda(programId);
  const dealPda = deriveDealPda(programId, input.buyer, input.tradeId);

  // Contract: repay_deal(trade_id: u64)
  const data = Buffer.concat([REPAY_DEAL_DISCRIMINATOR, encodeU64(input.tradeId)]);

  // RepayDeal accounts: pool_state, buyer(signer), deal, buyer_token_account,
  //   platform_token_account, usdc_mint, token_program
  const keys: AccountMeta[] = [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: input.buyer, isSigner: true, isWritable: true },
    { pubkey: dealPda, isSigner: false, isWritable: true },
    { pubkey: input.buyerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: input.platformTokenAccount, isSigner: false, isWritable: true },
    { pubkey: input.usdcMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = input.buyer;
  transaction.recentBlockhash = blockhash;
  transaction.add(new TransactionInstruction({ keys, programId, data }));

  return { transaction, blockhash };
}

export async function buildDepositPoolTransaction(
  input: {
    depositor: PublicKey;
    amount: bigint;
    depositorTokenAccount: PublicKey;
    poolTokenAccount: PublicKey;
    usdcMint: PublicKey;
  },
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const programId = new PublicKey(TRADE_ENV.programId);
  const poolState = derivePoolStatePda(programId);
  const poolAuthority = derivePoolAuthorityPda(programId);

  // Contract: deposit_pool(amount: u64)
  const data = Buffer.concat([
    DEPOSIT_POOL_DISCRIMINATOR,
    encodeU64(input.amount),
  ]);

  // DepositPool accounts: pool_state, depositor(signer), depositor_token_account,
  //   pool_authority, pool_token_account, usdc_mint, token_program
  const keys: AccountMeta[] = [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: input.depositor, isSigner: true, isWritable: true },
    {
      pubkey: input.depositorTokenAccount,
      isSigner: false,
      isWritable: true,
    },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: input.poolTokenAccount, isSigner: false, isWritable: true },
    { pubkey: input.usdcMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = input.depositor;
  transaction.recentBlockhash = blockhash;
  transaction.add(new TransactionInstruction({ keys, programId, data }));

  return { transaction, blockhash };
}

export async function buildDefaultDealTransaction(
  input: {
    admin: PublicKey;
    buyer: PublicKey;
    tradeId: bigint;
    poolTokenAccount: PublicKey;
    dealTokenAccount: PublicKey;
    usdcMint: PublicKey;
  },
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const programId = new PublicKey(TRADE_ENV.programId);
  const poolState = derivePoolStatePda(programId);
  const poolAuthority = derivePoolAuthorityPda(programId);
  const dealPda = deriveDealPda(programId, input.buyer, input.tradeId);

  // Contract: default_deal(trade_id: u64)
  const data = Buffer.concat([
    DEFAULT_DEAL_DISCRIMINATOR,
    encodeU64(input.tradeId),
  ]);

  // DefaultDeal accounts: pool_state, admin(signer), buyer, deal, pool_authority,
  //   pool_token_account, deal_token_account, usdc_mint, token_program
  const keys: AccountMeta[] = [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: input.admin, isSigner: true, isWritable: true },
    { pubkey: input.buyer, isSigner: false, isWritable: false },
    { pubkey: dealPda, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: input.poolTokenAccount, isSigner: false, isWritable: true },
    { pubkey: input.dealTokenAccount, isSigner: false, isWritable: true },
    { pubkey: input.usdcMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = input.admin;
  transaction.recentBlockhash = blockhash;
  transaction.add(new TransactionInstruction({ keys, programId, data }));

  return { transaction, blockhash };
}
