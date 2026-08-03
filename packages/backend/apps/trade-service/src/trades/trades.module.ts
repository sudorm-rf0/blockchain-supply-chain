import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TradesController } from "./trades.controller";
import { TradesService } from "./trades.service";
import { AuditService } from "../audit/audit.service";
import { RedisService } from "../redis/redis.service";
import { AuthGuard } from "../auth/auth.guard";

@Module({
  controllers: [TradesController],
  providers: [TradesService, AuditService, AuthGuard, PrismaService, RedisService],
  exports: [PrismaService],
})
export class TradesModule {}
