function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value !== "" ? value : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

export const POOL_ENV = {
  redisUrl: env("REDIS_URL", "redis://localhost:6380"),
  port: envNumber("POOL_SERVICE_PORT", 3005),
  rpcUrl: env("SOLANA_RPC_URL", "http://localhost:8899"),
  programId: env(
    "TRADE_FINANCE_PROGRAM_ID",
    "9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3",
  ),
  usdcMint: env(
    "USDC_MINT",
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  ),
  lpMint: env(
    "LP_MINT",
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  ),
  maxWithdrawUsdc: envNumber("MAX_WITHDRAW_USDC", 1_000_000),
} as const;
