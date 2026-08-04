import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TradesController } from "./trades.controller";
import { TradesService } from "./trades.service";
import { AuditService } from "../audit/audit.service";
import { RedisService } from "../redis/redis.service";
import { AuthGuard } from "../auth/auth.guard";
import { RepaymentDueNotifierService } from "./repayment-due-notifier.service";
import { TradeMetricsService } from "./trade-metrics.service";
import { NotifierService } from "./notifier.service";
import { MetricsService } from "../../../../src/shared/metrics.service";

@Module({
  controllers: [TradesController],
  providers: [
    TradesService,
    AuditService,
    AuthGuard,
    PrismaService,
    RedisService,
    RepaymentDueNotifierService,
    TradeMetricsService,
    NotifierService,
    MetricsService,
  ],
  exports: [PrismaService],
})
export class TradesModule {}
