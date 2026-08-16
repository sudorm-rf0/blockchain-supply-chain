import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "@supply-chain/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FeedbackController } from "./feedback.controller";
import { AdminFeedbackController } from "./admin-feedback.controller";
import { FeedbackService } from "./feedback.service";

@Module({
  controllers: [FeedbackController, AdminFeedbackController],
  imports: [AuditModule, AuthModule],
  providers: [FeedbackService, RedisService, PrismaService],
})
export class FeedbackModule {}
