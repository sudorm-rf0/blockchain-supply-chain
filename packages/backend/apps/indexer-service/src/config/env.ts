function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value !== "" ? value : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

export const INDEXER_ENV = {
  rpcUrl: env("SOLANA_RPC_URL", "http://localhost:8899"),
  programId: env(
    "TRADE_FINANCE_PROGRAM_ID",
    "9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3",
  ),
  poolStateAddress: env("POOL_STATE_ADDRESS", ""),
  redisUrl: env("REDIS_URL", "redis://localhost:6380"),
  riskWebhookUrl: env(
    "RISK_WEBHOOK_URL",
    "http://localhost:8080/risk/defaulted",
  ),
  webhookSecret: env(
    "WEBHOOK_SECRET",
    "supply-chain-dev-webhook-secret",
  ),
  syncQueueName: env("SYNC_QUEUE_NAME", "sync-queue"),
  port: envNumber("INDEXER_PORT", 3003),
} as const;
