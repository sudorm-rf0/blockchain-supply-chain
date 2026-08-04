import {
  Controller,
  Get,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "./prisma/prisma.service";

@SkipThrottle()
@Controller("health")
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getHealth() {
    let db = "up";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "down";
    }
    return { status: "ok", service: "backend", db, timestamp: new Date().toISOString() };
  }

  @Get("ready")
  async getReady() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ready", db: "up" };
    } catch {
      throw new ServiceUnavailableException("database unavailable");
    }
  }

}
