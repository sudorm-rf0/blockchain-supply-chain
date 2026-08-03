import type { Commitment, Connection, TransactionSignature } from "@solana/web3.js";

const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;

/**
 * Waits for a transaction confirmation with a hard timeout so a stalled RPC
 * or dropped transaction cannot leave the UI spinning forever.
 */
export async function confirmTransactionWithTimeout(
  connection: Connection,
  signature: TransactionSignature,
  commitment: Commitment = "confirmed",
  timeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
): Promise<void> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`Transaction confirmation timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs,
    );
  });
  await Promise.race([
    connection.confirmTransaction(signature, commitment).then((result) => {
      if (result.value.err) {
        throw new Error("Transaction was rejected by the cluster");
      }
    }),
    timeout,
  ]);
}
