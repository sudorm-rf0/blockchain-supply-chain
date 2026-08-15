import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, PrismaService],
})
export class IntegrationsModule {}
