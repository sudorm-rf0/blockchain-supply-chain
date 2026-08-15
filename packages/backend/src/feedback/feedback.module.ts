import { Module } from "@nestjs/common";
import { RedisService } from "@supply-chain/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FeedbackController } from "./feedback.controller";
import { FeedbackService } from "./feedback.service";

@Module({
  controllers: [FeedbackController],
  imports: [AuditModule, AuthModule],
  providers: [FeedbackService, RedisService],
})
export class FeedbackModule {}
