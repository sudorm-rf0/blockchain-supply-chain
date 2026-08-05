import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import {
  AuthGuard,
  AdminGuard,
  RedisService,
  PRISMA_SERVICE,
} from "@supply-chain/common";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    AdminGuard,
    PrismaService,
    RedisService,
    { provide: PRISMA_SERVICE, useExisting: PrismaService },
  ],
  exports: [
    AuthService,
    AuthGuard,
    AdminGuard,
    PrismaService,
    RedisService,
    PRISMA_SERVICE,
  ],
})
export class AuthModule {}
