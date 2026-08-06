import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
  Type,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PRISMA_SERVICE, type PrismaQueryLike } from "../types";

/**
 * 三个子服务（indexer/trade/pool）此前各有一份几乎相同的 HealthController，
 * 仅 service 名不同。用工厂函数按服务名生成，消除重复。
 */
export function createHealthController(serviceName: string): Type<unknown> {
  @SkipThrottle()
  @ApiTags("health")
  @Controller("health")
  class HealthController {
    constructor(
      @Inject(PRISMA_SERVICE) private readonly prisma: PrismaQueryLike,
    ) {}

    @Get()
    @ApiOperation({ summary: "服务健康检查" })
    @ApiOkResponse({
      schema: {
        type: "object",
        properties: {
          status: { type: "string", example: "ok" },
          service: { type: "string", example: serviceName },
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
        service: serviceName,
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
  return HealthController;
}
