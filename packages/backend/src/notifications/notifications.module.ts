import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditModule } from "../audit/audit.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

// 注意：不要 import AuthModule（AuthModule 已依赖 NotificationsModule，会形成循环依赖）。
// Controller 的 AuthGuard/AdminGuard 来自 @supply-chain/common，无需 AuthModule。
@Module({
  controllers: [NotificationsController],
  imports: [AuditModule],
  providers: [NotificationsService, PrismaService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
