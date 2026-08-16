import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard, AuthGuard } from "@supply-chain/common";
import type { Request } from "express";
import { NotificationsService } from "./notifications.service";
import { AuditService } from "../audit/audit.service";

@UseGuards(AuthGuard)
@Controller("api/notifications")
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** 发布全站通知（管理员/超管），留存审计记录 */
  @Post("broadcast")
  @UseGuards(AuthGuard, AdminGuard)
  async broadcast(
    @Body() body: { title?: string; body?: string },
    @Req() req?: Request,
  ) {
    const n = await this.notifications.broadcast({
      creatorId: req!.user!.sub,
      title: body?.title ?? "",
      body: body?.body,
    });
    await this.audit.record({
      actorId: req!.user!.sub,
      actorEmail: req!.user!.email,
      action: "NOTIFICATION_BROADCAST",
      targetType: "NOTIFICATION",
      targetId: n.id,
      metadata: { title: n.title, broadcast: true },
    });
    return n;
  }

  @Get()
  list(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Req() req?: Request,
  ) {
    return this.notifications.list(req!.user!.sub, Number(page) || 1, Number(limit) || 20);
  }

  @Get("banner")
  banner(@Req() req?: Request) {
    return this.notifications.banner(req!.user!.sub);
  }

  @Get("unread-count")
  unreadCount(@Req() req?: Request) {
    return this.notifications.unreadCount(req!.user!.sub);
  }

  @Post(":id/read")
  markRead(@Param("id") id: string, @Req() req?: Request) {
    return this.notifications.markRead(req!.user!.sub, id);
  }

  @Post("read-all")
  markAllRead(@Req() req?: Request) {
    return this.notifications.markAllRead(req!.user!.sub);
  }
}
