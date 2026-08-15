import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthModule } from "../auth/auth.module";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";

@Module({
  controllers: [IntegrationsController],
  imports: [AuthModule],
  providers: [IntegrationsService, PrismaService],
})
export class IntegrationsModule {}
