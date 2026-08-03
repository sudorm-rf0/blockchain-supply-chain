import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";
import { AuditRetentionService } from "./audit-retention.service";

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditRetentionService, PrismaService],
  exports: [AuditService],
})
export class AuditModule {}
