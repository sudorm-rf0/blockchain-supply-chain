import { Module } from "@nestjs/common";
import {
  AuthGuard,
  PRISMA_SERVICE,
  RedisService,
  SuperAdminGuard,
} from "@supply-chain/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditModule } from "../audit/audit.module";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  imports: [AuditModule],
  controllers: [SettingsController],
  providers: [
    SettingsService,
    AuthGuard,
    SuperAdminGuard,
    PrismaService,
    RedisService,
    { provide: PRISMA_SERVICE, useExisting: PrismaService },
  ],
  exports: [SettingsService],
})
export class SettingsModule {}
