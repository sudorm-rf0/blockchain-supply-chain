import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IsInt, Max, Min } from "class-validator";
import type { Request } from "express";
import { AuthGuard, SuperAdminGuard } from "@supply-chain/common";
import { AuditService } from "../audit/audit.service";
import { InviteCodesService } from "./invite-codes.service";

export class GenerateInviteCodesDto {
  @IsInt()
  @Min(1)
  @Max(500)
  count!: number;
}

/** 超级管理员邀请码管理：批量生成、查看使用情况、导出清单。 */
@Controller("api/admin/invite-codes")
@UseGuards(AuthGuard, SuperAdminGuard)
export class InviteCodesController {
  constructor(
    private readonly inviteCodes: InviteCodesService,
    private readonly audit: AuditService,
  ) {}

  @Post("generate")
  async generate(
    @Body() body: GenerateInviteCodesDto,
    @Req() req: Request,
  ) {
    const codes = await this.inviteCodes.generate(body.count, req.user!.sub);
    await this.audit.record({
      actorId: req.user!.sub,
      actorEmail: req.user!.email,
      action: "INVITE_CODES_GENERATED",
      targetType: "INVITE_CODE",
      targetId: `batch-${body.count}`,
      metadata: { count: body.count },
    });
    return { ok: true, count: codes.length, codes };
  }

  @Get()
  async list() {
    return { items: await this.inviteCodes.list() };
  }

  /** 邀请码使用统计：总数/已用/未用/使用率、角色分布、近 30 天趋势、最近使用。 */
  @Get("stats")
  async stats() {
    return this.inviteCodes.stats();
  }

  /** 导出清单：纯文本，每行一个邀请码（含使用状态），可直接复制/打印。 */
  @Get("export")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="invite-codes.txt"')
  async export() {
    const rows = await this.inviteCodes.list();
    const lines = rows.map((r) => {
      const state = r.usedAt
        ? `已使用${r.usedByEmail ? `(${r.usedByEmail})` : ""}`
        : "未使用";
      return `${r.code}  ${state}`;
    });
    const body = lines.length > 0 ? lines.join("\n") + "\n" : "(暂无邀请码)\n";
    return body;
  }
}
