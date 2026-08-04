export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
export const TRADE_API_URL =
  process.env.NEXT_PUBLIC_TRADE_API_URL ?? "http://localhost:3004";
export const POOL_API_URL =
  process.env.NEXT_PUBLIC_POOL_API_URL ?? "http://localhost:3005";
export const INDEXER_API_URL =
  process.env.NEXT_PUBLIC_INDEXER_API_URL ?? "http://localhost:3003";

export const API_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS ?? 15000);
