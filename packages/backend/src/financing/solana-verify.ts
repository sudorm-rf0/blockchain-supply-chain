import { BadRequestException } from "@nestjs/common";
import { Connection, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

/** USDC 转账校验规格：from→to 转账金额下限。 */
export interface TransferSpec {
  from: PublicKey;
  to: PublicKey;
  minAmount: bigint;
}

function collectInstructions(tx: ParsedTransactionWithMeta): any[] {
  const outer = (tx.transaction.message.instructions ?? []) as any[];
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions as any[]);
  return [...outer, ...inner];
}

/** 在交易中查找一条 USDC transfer 指令：source/destination 为对应 ATA，金额 ≥ minAmount。 */
export function findUsdcTransfer(
  tx: ParsedTransactionWithMeta,
  mint: PublicKey,
  spec: TransferSpec,
): boolean {
  const fromAta = getAssociatedTokenAddressSync(mint, spec.from).toBase58();
  const toAta = getAssociatedTokenAddressSync(mint, spec.to).toBase58();
  return collectInstructions(tx).some((ix) => {
    const parsed = ix?.parsed as any;
    const program = ix?.programId;
    const programId = typeof program === "string" ? program : program?.toBase58?.();
    if (programId !== TOKEN_PROGRAM_ID.toBase58() || parsed?.type !== "transfer") return false;
    const info = parsed.info ?? {};
    return (
      info.source === fromAta &&
      info.destination === toAta &&
      BigInt(info.amount ?? 0) >= spec.minAmount
    );
  });
}

/** 审计 H-4：校验链上确实发生了一笔满足规格的 USDC 转账，否则抛 BadRequest。 */
export async function verifyUsdcTransfer(
  connection: Connection,
  txSignature: string,
  mint: PublicKey,
  spec: TransferSpec,
): Promise<void> {
  let tx: ParsedTransactionWithMeta | null;
  try {
    tx = await connection.getParsedTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch {
    throw new BadRequestException("交易签名无效或尚未上链");
  }
  if (!tx || tx.meta?.err) {
    throw new BadRequestException("交易未在链上确认");
  }
  if (!findUsdcTransfer(tx, mint, spec)) {
    throw new BadRequestException("交易不包含预期的 USDC 转账（金额或账户不匹配）");
  }
}
