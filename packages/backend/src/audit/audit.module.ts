import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthGuard, AdminGuard } from "@supply-chain/common";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";
import { AuditRetentionService } from "./audit-retention.service";

@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditRetentionService,
    PrismaService,
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
  exports: [AuditService],
})
export class AuditModule {}
