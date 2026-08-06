// RPC 多 Key 轮询：SOLANA_RPC_URL 支持逗号分隔的多个端点，
// 逐个轮询以分摊单个 Key 的配额/限流（429）。
let rpcIndex = 0;

export function pickRpcUrl(config: string): string {
  const urls = config
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (urls.length <= 1) return config;
  const picked = urls[rpcIndex % urls.length];
  rpcIndex += 1;
  return picked;
}
