import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TradesController } from "./trades.controller";
import { TradesService } from "./trades.service";
import { AuditService } from "../audit/audit.service";
import { RedisService } from "../redis/redis.service";
import { AuthGuard } from "../auth/auth.guard";
import { RepaymentDueNotifierService } from "./repayment-due-notifier.service";

@Module({
  controllers: [TradesController],
  providers: [
    TradesService,
    AuditService,
    AuthGuard,
    PrismaService,
    RedisService,
    RepaymentDueNotifierService,
  ],
  exports: [PrismaService],
})
export class TradesModule {}
