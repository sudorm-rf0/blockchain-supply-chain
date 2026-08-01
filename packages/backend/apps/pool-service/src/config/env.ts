function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value !== "" ? value : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

export const POOL_ENV = {
  redisUrl: env("REDIS_URL", "redis://localhost:6379"),
  port: envNumber("POOL_SERVICE_PORT", 3005),
} as const;
