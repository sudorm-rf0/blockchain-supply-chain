import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  RedisService,
  AuthGuard,
  AdminGuard,
  PRISMA_SERVICE,
} from "@supply-chain/common";
import { PoolController } from "./pool.controller";
import { PoolService } from "./pool.service";
import { WithdrawalWorkerService } from "./withdrawal-worker.service";
import { AuditService } from "@supply-chain/common";

@Module({
  controllers: [PoolController],
  providers: [
    PoolService,
    WithdrawalWorkerService,
    AuditService,
    AuthGuard,
    AdminGuard,
    PrismaService,
    RedisService,
    { provide: PRISMA_SERVICE, useExisting: PrismaService },
  ],
  exports: [PrismaService, PRISMA_SERVICE],
})
export class PoolModule {}
