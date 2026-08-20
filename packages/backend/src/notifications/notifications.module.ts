import { Module } from "@nestjs/common";
import { PRISMA_SERVICE } from "@supply-chain/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditModule } from "../audit/audit.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

// 注意：不要 import AuthModule（AuthModule 已依赖 NotificationsModule，会形成循环依赖）。
// Controller 的 AuthGuard/AdminGuard 来自 @supply-chain/common，需要 PRISMA_SERVICE token，
// 由本模块自行提供（PrismaService + PRISMA_SERVICE 别名），不再依赖 AuthModule。
@Module({
  controllers: [NotificationsController],
  imports: [AuditModule],
  providers: [
    NotificationsService,
    PrismaService,
    { provide: PRISMA_SERVICE, useExisting: PrismaService },
  ],
  exports: [NotificationsService, PrismaService, PRISMA_SERVICE],
})
export class NotificationsModule {}
