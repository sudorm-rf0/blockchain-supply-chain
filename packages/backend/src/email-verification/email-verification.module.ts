import { Module } from "@nestjs/common";
import { RedisService } from "@supply-chain/common";
import { AuditModule } from "../audit/audit.module";
import { EmailVerificationController } from "./email-verification.controller";
import { EmailVerificationService } from "./email-verification.service";

@Module({
  imports: [AuditModule],
  controllers: [EmailVerificationController],
  providers: [EmailVerificationService, RedisService],
  exports: [EmailVerificationService],
})
export class EmailVerificationModule {}
