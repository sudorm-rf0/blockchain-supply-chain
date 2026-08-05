import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(
      process.env.REDIS_URL ?? "redis://localhost:6380",
      { maxRetriesPerRequest: 1, lazyConnect: true },
    );
    this.client.on("error", () => undefined);
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
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
    } catch {
      // Redis 不可用时静默降级。
    }
  }

  /** pool-service 曾用的别名，参数顺序 (key, value, seconds)。 */
  async setWithExpiry(key: string, value: string, seconds: number): Promise<void> {
    await this.setEx(key, seconds, value);
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch {
      return 0;
    }
  }

  async expire(key: string, seconds: number): Promise<void> {
    try {
      await this.client.expire(key, seconds);
    } catch {
      // 忽略。
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      // 忽略。
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
