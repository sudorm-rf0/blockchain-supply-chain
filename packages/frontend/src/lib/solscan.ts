/** Solscan 交易链接（按当前 RPC 网络自动加 cluster 参数） */
export function solscanTxUrl(txSignature: string): string {
  const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "";
  const cluster = rpc.includes("devnet") ? "?cluster=devnet" : "";
  return `https://solscan.io/tx/${txSignature}${cluster}`;
}
