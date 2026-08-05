import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthGuard, AdminGuard, PRISMA_SERVICE } from "@supply-chain/common";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";
import { AuditRetentionService } from "./audit-retention.service";

@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditRetentionService,
    AuthGuard,
    AdminGuard,
    PrismaService,
    { provide: PRISMA_SERVICE, useExisting: PrismaService },
  ],
  exports: [AuditService],
})
export class AuditModule {}
