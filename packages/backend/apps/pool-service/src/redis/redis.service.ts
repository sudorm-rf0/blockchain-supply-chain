import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { POOL_ENV } from "../config/env";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(POOL_ENV.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.client.on("error", () => undefined);
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async setWithExpiry(key: string, value: string, seconds: number): Promise<void> {
    try {
      await this.client.set(key, value, "EX", seconds);
    } catch {
      // silently ignore write errors
    }
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
      // silently ignore
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
