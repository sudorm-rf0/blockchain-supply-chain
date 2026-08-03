import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { PoolController } from "./pool.controller";
import { PoolService } from "./pool.service";
import { WithdrawalWorkerService } from "./withdrawal-worker.service";
import { AuditService } from "../audit/audit.service";
import { AuthGuard } from "../auth/auth.guard";

@Module({
  controllers: [PoolController],
  providers: [
    PoolService,
    WithdrawalWorkerService,
    AuditService,
    AuthGuard,
    PrismaService,
    RedisService,
  ],
  exports: [PrismaService],
})
export class PoolModule {}
