import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthGuard, AdminGuard, RedisService } from "@supply-chain/common";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PrismaService,
    RedisService,
    {
      provide: AuthGuard,
      useFactory: (prisma: PrismaService) => new AuthGuard(prisma),
      inject: [PrismaService],
    },
    {
      provide: AdminGuard,
      useFactory: (prisma: PrismaService) => new AdminGuard(prisma),
      inject: [PrismaService],
    },
  ],
  exports: [AuthService, AuthGuard, AdminGuard, PrismaService, RedisService],
})
export class AuthModule {}