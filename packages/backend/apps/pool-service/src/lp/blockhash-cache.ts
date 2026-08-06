import { Connection } from "@solana/web3.js";

let cached:
  | { blockhash: string; lastValidBlockHeight: number; expiresAt: number }
  | undefined;

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
