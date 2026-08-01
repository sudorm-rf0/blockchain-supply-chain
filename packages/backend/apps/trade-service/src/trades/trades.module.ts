import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TradesController } from "./trades.controller";
import { TradesService } from "./trades.service";

@Module({
  controllers: [TradesController],
  providers: [TradesService, PrismaService],
})
export class TradesModule {}
