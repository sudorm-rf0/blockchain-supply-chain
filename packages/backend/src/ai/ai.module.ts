import { Module } from "@nestjs/common";
import { RedisService } from "@supply-chain/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { AiLlmService } from "./ai-llm.service";
import { AssistantService } from "./assistant.service";
import { AssistantController } from "./assistant.controller";
import { AiStatsController } from "./ai-stats.controller";

@Module({
  controllers: [AssistantController, AiStatsController],
  imports: [AuthModule, AuditModule],
  providers: [AiLlmService, AssistantService, RedisService, PrismaService],
  exports: [AiLlmService],
})
export class AiModule {}
