import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { POOL_ENV } from "../config/env";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(POOL_ENV.redisUrl);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setWithExpiry(key: string, value: string, seconds: number): Promise<void> {
    await this.client.set(key, value, "EX", seconds);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
