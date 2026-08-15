import { Module } from "@nestjs/common";
import { RedisService } from "@supply-chain/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { AiLlmService } from "./ai-llm.service";
import { AssistantService } from "./assistant.service";
import { AssistantController } from "./assistant.controller";

@Module({
  controllers: [AssistantController],
  imports: [AuthModule, AuditModule],
  providers: [AiLlmService, AssistantService, RedisService],
  exports: [AiLlmService],
})
export class AiModule {}
