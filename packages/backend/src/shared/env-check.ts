const PRODUCTION = process.env.NODE_ENV === "production";

export interface StartupEnvIssue {
  name: string;
  reason: string;
  fatal: boolean;
}

export function validateStartupEnv(options: {
  required: string[];
  secrets?: string[];
  redisRequired?: boolean;
  rpcRequired?: boolean;
}): StartupEnvIssue[] {
  const issues: StartupEnvIssue[] = [];
  const missing = options.required.filter(
    (name) => !process.env[name] || process.env[name]!.trim() === "",
  );
  for (const name of missing) {
    issues.push({
      name,
      reason: "required environment variable is not set",
      fatal: PRODUCTION || name === "DATABASE_URL",
    });
  }

  for (const name of options.secrets ?? []) {
    const value = process.env[name] ?? "";
    if (PRODUCTION && value.length < 32) {
      issues.push({
        name,
        reason:
          "production requires a strong secret (>= 32 chars); the dev fallback is not allowed",
        fatal: true,
      });
    }
  }

  if (options.redisRequired && process.env.REDIS_URL && !process.env.REDIS_URL.startsWith("redis://")) {
    issues.push({
      name: "REDIS_URL",
      reason: "must start with redis://",
      fatal: true,
    });
  }

  if (options.rpcRequired) {
    const rpc = process.env.SOLANA_RPC_URL ?? "";
    if (PRODUCTION && (rpc === "" || rpc === "http://localhost:8899")) {
      issues.push({
        name: "SOLANA_RPC_URL",
        reason: "production cannot point at localhost; configure a real RPC endpoint",
        fatal: true,
      });
    }
  }

  return issues;
}

export function assertStartupEnv(issues: StartupEnvIssue[]): void {
  if (issues.length === 0) return;
  const fatal = issues.filter((issue) => issue.fatal);
  const lines = issues.map(
    (issue) => `[${issue.fatal ? "FATAL" : "WARN"}] ${issue.name}: ${issue.reason}`,
  );
  if (fatal.length > 0) {
    throw new Error(`Startup environment validation failed:\n${lines.join("\n")}`);
  }
  console.warn(`Startup environment warnings:\n${lines.join("\n")}`);
}
