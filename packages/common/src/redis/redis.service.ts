import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

// ---- 模块级失败计数（跨实例共享，供指标/告警读取）----
let failureCount = 0;
let lastFailureAt: number | null = null;

export function getRedisFailureCount(): number {
  return failureCount;
}

export function getRedisLastFailureAt(): number | null {
  return lastFailureAt;
}

/** 仅供测试重置，生产环境不要调用。 */
export function resetRedisFailureCount(): void {
  failureCount = 0;
  lastFailureAt = null;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(
      process.env.REDIS_URL ?? "redis://localhost:6380",
      { maxRetriesPerRequest: 1, lazyConnect: true },
    );
    this.client.on("error", () => undefined);
  }

  private recordFailure(op: string, error: unknown, level: "error" | "warn"): void {
    failureCount += 1;
    lastFailureAt = Date.now();
    const message = `Redis operation "${op}" failed (total=${failureCount}): ${String(error)}`;
    if (level === "error") {
      // 安全相关操作（登录防暴破计数等）失败是 fail-open 风险，必须告警而不是静默。
      this.logger.error(message);
    } else {
      this.logger.warn(message);
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      this.recordFailure("get", error, "warn");
      return null;
    }
  }

  // setNX 不吞错：由调用方决定降级策略（如 503 / 跳过本轮）。
  async setNX(key: string, value: string, seconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, "EX", seconds, "NX");
    return result === "OK";
  }

  async setEx(key: string, seconds: number, value: string): Promise<void> {
    try {
      await this.client.set(key, value, "EX", seconds);
    } catch (error) {
      this.recordFailure("setEx", error, "warn");
    }
  }

  /** pool-service 曾用的别名，参数顺序 (key, value, seconds)。 */
  async setWithExpiry(key: string, value: string, seconds: number): Promise<void> {
    await this.setEx(key, seconds, value);
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      // 防暴破/限流计数失败 → fail-open，必须记录为 error 级别以便告警联动。
      this.recordFailure("incr", error, "error");
      return 0;
    }
  }

  async expire(key: string, seconds: number): Promise<void> {
    try {
      await this.client.expire(key, seconds);
    } catch (error) {
      this.recordFailure("expire", error, "warn");
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      this.recordFailure("del", error, "warn");
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
