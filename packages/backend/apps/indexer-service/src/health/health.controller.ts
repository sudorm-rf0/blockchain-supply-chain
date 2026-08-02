import {
  Controller,
  Get,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service";

@SkipThrottle()
@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: "服务健康检查" })
  @ApiOkResponse({
    schema: {
      type: "object",
      properties: {
        status: { type: "string", example: "ok" },
        service: { type: "string", example: "indexer-service" },
        timestamp: { type: "string" },
      },
    },
  })
  async getHealth() {
    let db = "up";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "down";
    }
    return {
      status: "ok",
      service: "indexer-service",
      db,
      timestamp: new Date().toISOString(),
    };
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
