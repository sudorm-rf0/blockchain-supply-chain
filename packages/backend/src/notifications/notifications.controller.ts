import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@supply-chain/common";
import type { Request } from "express";
import { NotificationsService } from "./notifications.service";

@UseGuards(AuthGuard)
@Controller("api/notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Req() req?: Request,
  ) {
    return this.notifications.list(req!.user!.sub, Number(page) || 1, Number(limit) || 20);
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
