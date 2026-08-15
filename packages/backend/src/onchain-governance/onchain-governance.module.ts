import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthModule } from "../auth/auth.module";
import { OnchainGovernanceController } from "./onchain-governance.controller";
import { OnchainGovernanceService } from "./onchain-governance.service";

@Module({
  controllers: [OnchainGovernanceController],
  imports: [AuthModule],
  providers: [OnchainGovernanceService, PrismaService],
})
export class OnchainGovernanceModule {}
