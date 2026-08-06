import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TradesController } from "./trades.controller";
import { TradesService } from "./trades.service";
import { AuditService } from "@supply-chain/common";
import {
  RedisService,
  AuthGuard,
  AdminGuard,
  PRISMA_SERVICE,
} from "@supply-chain/common";
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
    AdminGuard,
    PrismaService,
    RedisService,
    { provide: PRISMA_SERVICE, useExisting: PrismaService },
    RepaymentDueNotifierService,
    TradeMetricsService,
    NotifierService,
    MetricsService,
  ],
  exports: [PrismaService, PRISMA_SERVICE],
})
export class TradesModule {}
