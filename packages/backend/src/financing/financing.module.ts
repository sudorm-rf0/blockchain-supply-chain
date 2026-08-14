import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FinancingController } from "./financing.controller";
import { FinancingService } from "./financing.service";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [FinancingController],
  providers: [FinancingService, PrismaService],
})
export class FinancingModule {}
