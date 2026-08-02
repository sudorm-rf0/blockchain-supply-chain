import { createHash } from "node:crypto";
import {
  AccountMeta,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { POOL_ENV } from "../config/env";

const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

function encodeU64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

function derivePda(seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, new PublicKey(POOL_ENV.programId))[0];
}

function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export function derivePoolStatePda(): PublicKey {
  return derivePda([Buffer.from("trade_finance"), Buffer.from("pool")]);
}

export function derivePoolAuthorityPda(): PublicKey {
  return derivePda([Buffer.from("trade_finance"), Buffer.from("pool_usdc")]);
}

export function deriveUsdcAta(owner: PublicKey): PublicKey {
  return deriveAta(owner, new PublicKey(POOL_ENV.usdcMint));
}

export function deriveLpAta(owner: PublicKey): PublicKey {
  return deriveAta(owner, new PublicKey(POOL_ENV.lpMint));
}

export function buildRedeemLpInstructionData(lpAmount: bigint): Buffer {
  const discriminator = createHash("sha256")
    .update("global:redeem_lp")
    .digest()
    .subarray(0, 8);
  return Buffer.concat([discriminator, encodeU64(lpAmount)]);
}

export async function buildRedeemLpTransaction(
  lpUser: PublicKey,
  lpAmount: bigint,
  connection: Connection,
): Promise<{ transaction: Transaction; blockhash: string }> {
  const programId = new PublicKey(POOL_ENV.programId);
  const usdcMint = new PublicKey(POOL_ENV.usdcMint);
  const lpMint = new PublicKey(POOL_ENV.lpMint);
  const poolState = derivePoolStatePda();
  const poolAuthority = derivePoolAuthorityPda();
  const lpUserTokenAccount = deriveLpAta(lpUser);
  const lpUserUsdcTokenAccount = deriveUsdcAta(lpUser);
  const poolTokenAccount = deriveUsdcAta(poolAuthority);

  const keys: AccountMeta[] = [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: lpUser, isSigner: true, isWritable: true },
    { pubkey: lpUserTokenAccount, isSigner: false, isWritable: true },
    { pubkey: lpUserUsdcTokenAccount, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
    { pubkey: usdcMint, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = buildRedeemLpInstructionData(lpAmount);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = lpUser;
  transaction.recentBlockhash = blockhash;
  transaction.add(new TransactionInstruction({ keys, programId, data }));
  return { transaction, blockhash };
}

export const REDEEM_LP_SYSTEM_PROGRAM_ID = SYSTEM_PROGRAM_ID;
