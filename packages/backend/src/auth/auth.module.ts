import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { TurnstileService } from "./turnstile.service";
import {
  AuthGuard,
  AdminGuard,
  SuperAdminGuard,
  RedisService,
  PRISMA_SERVICE,
} from "@supply-chain/common";
import { AuditModule } from "../audit/audit.module";
import { SettingsModule } from "../settings/settings.module";
import { EmailVerificationModule } from "../email-verification/email-verification.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [AuditModule, EmailVerificationModule, SettingsModule, NotificationsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TurnstileService,
    AuthGuard,
    AdminGuard,
    SuperAdminGuard,
    PrismaService,
    RedisService,
    { provide: PRISMA_SERVICE, useExisting: PrismaService },
  ],
  exports: [
    AuthService,
    TurnstileService,
    AuthGuard,
    AdminGuard,
    SuperAdminGuard,
    PrismaService,
    RedisService,
    PRISMA_SERVICE,
  ],
})
export class AuthModule {}
