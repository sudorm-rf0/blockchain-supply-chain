import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FinancingController } from "./financing.controller";
import { FinancingService } from "./financing.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [FinancingController],
  providers: [FinancingService, PrismaService],
})
export class FinancingModule {}
