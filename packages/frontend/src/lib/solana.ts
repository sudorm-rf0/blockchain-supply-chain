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
  const deadline = Date.now() + timeoutMs;
  let delayMs = 500;

  while (Date.now() < deadline) {
    try {
      const { value } = await connection.getSignatureStatuses([signature]);
      const status = value?.[0];
      if (status) {
        if (status.err) {
          throw new Error("Transaction was rejected by the cluster");
        }
        const current = status.confirmationStatus;
        const reached =
          current === commitment ||
          (commitment === "confirmed" && current === "finalized");
        if (reached) {
          return;
        }
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("rejected by the cluster")) {
        throw cause;
      }
      // RPC 抖动或签名暂未上链：继续轮询，不做中断。
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(Math.round(delayMs * 1.5), 3_000);
  }

  throw new Error(
    `Transaction confirmation timed out after ${Math.round(timeoutMs / 1000)}s`,
  );
}
