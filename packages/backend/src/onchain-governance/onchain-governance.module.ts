import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { OnchainGovernanceController } from "./onchain-governance.controller";
import { OnchainGovernanceService } from "./onchain-governance.service";

@Module({
  controllers: [OnchainGovernanceController],
  providers: [OnchainGovernanceService, PrismaService],
})
export class OnchainGovernanceModule {}
