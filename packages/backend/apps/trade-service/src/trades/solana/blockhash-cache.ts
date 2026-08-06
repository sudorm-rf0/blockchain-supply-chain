import { Connection } from "@solana/web3.js";

let cached:
  | { blockhash: string; lastValidBlockHeight: number; expiresAt: number }
  | undefined;

// 200ms 短缓存：同一窗口内多个交易构建复用同一个 blockhash，
// 显著减少真实 RPC 的 getLatestBlockhash 压力（blockhash 有效期远大于 200ms）。
export async function getCachedBlockhash(
  connection: Pick<Connection, "getLatestBlockhash">,
  ttlMs = 200,
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  if (ttlMs > 0 && cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  const blockhash = await connection.getLatestBlockhash("confirmed");
  cached = { ...blockhash, expiresAt: Date.now() + ttlMs };
  return cached;
}
