import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TradesController } from "./trades.controller";
import { TradesService } from "./trades.service";
import { AuditService } from "../audit/audit.service";
import { RedisService, AuthGuard, AdminGuard } from "@supply-chain/common";
import { RepaymentDueNotifierService } from "./repayment-due-notifier.service";
import { TradeMetricsService } from "./trade-metrics.service";
import { NotifierService } from "./notifier.service";
import { MetricsService } from "../../../../src/shared/metrics.service";

@Module({
  controllers: [TradesController],
  providers: [
    TradesService,
    AuditService,
    PrismaService,
    RedisService,
    {
      provide: AuthGuard,
      useFactory: (prisma: PrismaService) => new AuthGuard(prisma),
      inject: [PrismaService],
    },
    {
      provide: AdminGuard,
      useFactory: (prisma: PrismaService) => new AdminGuard(prisma),
      inject: [PrismaService],
    },
    RepaymentDueNotifierService,
    TradeMetricsService,
    NotifierService,
    MetricsService,
  ],
  exports: [PrismaService],
})
export class TradesModule {}