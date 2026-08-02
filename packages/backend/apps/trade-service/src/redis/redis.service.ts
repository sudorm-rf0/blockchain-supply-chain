import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    this.client.on("error", () => undefined);
  }

  async setNX(key: string, value: string, seconds: number): Promise<boolean> {
    try {
      const result = await this.client.set(key, value, "EX", seconds, "NX");
      return result === "OK";
    } catch {
      return false;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      // Redis 不可用时忽略，锁自然过期。
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
