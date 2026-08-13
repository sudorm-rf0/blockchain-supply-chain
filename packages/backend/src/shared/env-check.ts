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
    // 审计 P0-3：生产环境禁止连接 Solana devnet，防止"公网站点跑在测试链"的配置错配。
    // 仅上线前演练可显式设置 ALLOW_DEVNET_RPC_IN_PRODUCTION=true；Go-Live 前必须关闭。
    if (PRODUCTION && rpc && /devnet/i.test(rpc)) {
      const allowDevnet = process.env.ALLOW_DEVNET_RPC_IN_PRODUCTION === "true";
      if (!allowDevnet) {
        issues.push({
          name: "SOLANA_RPC_URL",
          reason:
            "production cannot point at Solana devnet; set ALLOW_DEVNET_RPC_IN_PRODUCTION=true ONLY for pre-launch testing",
          fatal: true,
        });
      } else {
        issues.push({
          name: "SOLANA_RPC_URL",
          reason:
            "WARNING: production is running against Solana devnet (explicitly allowed by ALLOW_DEVNET_RPC_IN_PRODUCTION) - disable before Go-Live",
          fatal: false,
        });
      }
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
