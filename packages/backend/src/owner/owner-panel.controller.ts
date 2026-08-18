import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, SuperAdminGuard } from "@supply-chain/common";
import { VisitLogService } from "./visit-log.service";

/** 隐形站长面板（仅超级管理员，且不在任何菜单/链接中暴露） */
@UseGuards(AuthGuard, SuperAdminGuard)
@Controller("api/admin/owner")
export class OwnerPanelController {
  constructor(private readonly visitsService: VisitLogService) {}

  @Get("summary")
  summary() {
    return this.visitsService.summary();
  }

  @Get("visits")
  visits(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("ip") ip?: string,
    @Query("path") path?: string,
  ) {
    const p = Math.max(1, Number(page ?? 1) || 1);
    const l = Math.min(200, Math.max(1, Number(limit ?? 50) || 50));
    return this.visitsService.list({ page: p, limit: l, ip, path });
  }

  @Get("webmaster")
  webmaster() {
    return this.visitsService.webmaster();
  }
}
