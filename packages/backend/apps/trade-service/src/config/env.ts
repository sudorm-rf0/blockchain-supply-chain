function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value !== "" ? value : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

export const TRADE_ENV = {
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
  port: envNumber("TRADE_SERVICE_PORT", 3004),
} as const;

if (process.env.NODE_ENV === "production" && !process.env.LP_MINT) {
  throw new Error(
    "LP_MINT must be set for fund/repay transactions. In development, " +
    "set LP_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (same as USDC_MINT dev default).",
  );
}
