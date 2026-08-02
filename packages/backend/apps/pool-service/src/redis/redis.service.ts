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

  async setNX(key: string, value: string, seconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, "EX", seconds, "NX");
    return result === "OK";
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
