import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService, AuthGuard, AdminGuard } from "@supply-chain/common";
import { PoolController } from "./pool.controller";
import { PoolService } from "./pool.service";
import { WithdrawalWorkerService } from "./withdrawal-worker.service";
import { AuditService } from "../audit/audit.service";

@Module({
  controllers: [PoolController],
  providers: [
    PoolService,
    WithdrawalWorkerService,
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
  ],
  exports: [PrismaService],
})
export class PoolModule {}