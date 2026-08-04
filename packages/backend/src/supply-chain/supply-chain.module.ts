import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { SupplyChainController } from "./supply-chain.controller";
import { SupplyChainService } from "./supply-chain.service";

@Module({
  imports: [AuthModule],
  controllers: [SupplyChainController],
  providers: [SupplyChainService, PrismaService, AuditService],
})
export class SupplyChainModule {}
