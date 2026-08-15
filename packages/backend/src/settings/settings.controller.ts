import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard, SuperAdminGuard } from "@supply-chain/common";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService, SystemSettings, DeepPartial } from "./settings.service";

/** 系统设置（仅超级管理员可读写）。 */
@Controller("api/admin/settings")
@UseGuards(AuthGuard, SuperAdminGuard)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  get(): Promise<SystemSettings> {
    return this.settings.get();
  }

  @Put()
  async update(
    @Body() patch: DeepPartial<SystemSettings>,
    @Req() req: Request,
  ): Promise<SystemSettings> {
    // 防锁死：开启「管理员强制 TOTP」前，操作者自身必须已开启 TOTP
    if (patch.security?.requireTotpForAdmins === true) {
      const actor = await this.prisma.user.findUnique({
        where: { id: req.user!.sub },
        select: { totpEnabled: true },
      });
      if (!actor?.totpEnabled) {
        throw new BadRequestException(
          "开启「管理员强制 TOTP」前，请先为当前超级管理员账号开启两步验证",
        );
      }
    }
    return this.settings.update(patch, {
      id: req.user!.sub,
      email: req.user!.email,
    });
  }

  @Post("reset")
  reset(@Req() req: Request): Promise<SystemSettings> {
    return this.settings.reset({ id: req.user!.sub, email: req.user!.email });
  }
}
