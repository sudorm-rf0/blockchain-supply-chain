import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { randomBytes, scryptSync } from "node:crypto";
import type { Request } from "express";
import { AuthGuard, SuperAdminGuard } from "@supply-chain/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateAccountDto } from "./dto/create-account.dto";
import { ChangeRoleDto } from "./dto/change-role.dto";

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

/** 超级管理员账号管理：查看所有账号信息/内容、添加管理员、调整账户类型。 */
@Controller("api/admin/accounts")
@UseGuards(AuthGuard, SuperAdminGuard)
export class AccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("q") q?: string,
    @Query("role") role?: string,
  ) {
    const take = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;
    const where = {
      // 隐藏账号（如紧急运维账号）对任何角色包括超管均不可见
      hidden: false,
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" as const } },
              { name: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(role ? { role } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          wallet: true,
          emailVerified: true,
          emailOtpEnabled: true,
          totpEnabled: true,
          mustChangePassword: true,
          createdAt: true,
          lastPasswordChangeAt: true,
          inviteCode: { select: { code: true } },
          _count: { select: { files: true, buyerDeals: true, sellerDeals: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: Math.max(1, Number(page) || 1), limit: take };
  }

  @Get(":id")
  async detail(@Param("id") id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        hidden: true,
        email: true,
        name: true,
        role: true,
        wallet: true,
        emailVerified: true,
        emailOtpEnabled: true,
        totpEnabled: true,
        mustChangePassword: true,
        createdAt: true,
        lastPasswordChangeAt: true,
        files: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            filename: true,
            status: true,
            size: true,
            createdAt: true,
            txSignature: true,
          },
        },
        buyerDeals: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, dealId: true, status: true, amount: true, createdAt: true },
        },
        sellerDeals: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, dealId: true, status: true, amount: true, createdAt: true },
        },
      },
    });
    if (!user) throw new NotFoundException("账号不存在");
    // 隐藏账号对任何角色（包括超管）不可见：详情同样 404，且不泄露 hidden 字段。
    if (user.hidden) throw new NotFoundException("账号不存在");
    const { hidden: _hidden, ...visible } = user;
    return visible;
  }

  /** 添加管理员/超级管理员账号（可直接登录，密码由超级管理员设定）。 */
  @Post()
  async create(@Body() body: CreateAccountDto, @Req() req: Request) {
    const existing = await this.prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
    });
    if (existing) throw new ConflictException("该邮箱已被注册");

    const salt = randomBytes(16).toString("hex");
    const passwordHash = hashPassword(body.password, salt);
    const user = await this.prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        name: body.name,
        wallet: body.email.toLowerCase(),
        role: body.role,
        passwordHash: `${salt}:${passwordHash}`,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        // 内部管理账号由超级管理员创建，默认不强制邮箱验证码登录
        emailOtpEnabled: false,
        mustChangePassword: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
    // 审计 M7：管理端创建账号必须留痕。
    await this.audit.record({
      actorId: req.user!.sub,
      actorEmail: req.user!.email,
      action: "ADMIN_ACCOUNT_CREATED",
      targetType: "ACCOUNT",
      targetId: user.id,
      metadata: { email: user.email, role: user.role },
    });
    return user;
  }

  /** 调整账户类型（USER / ADMIN / SUPER_ADMIN）。 */
  @Patch(":id/role")
  async changeRole(
    @Param("id") id: string,
    @Body() body: ChangeRoleDto,
    @Req() req: Request,
  ) {
    if (id === req.user!.sub) {
      throw new BadRequestException("不能修改自己的账户类型");
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("账号不存在");

    if (
      user.role === "SUPER_ADMIN" &&
      body.role !== "SUPER_ADMIN"
    ) {
      // 保留至少一名超级管理员
      const superAdmins = await this.prisma.user.count({
        where: { role: "SUPER_ADMIN" },
      });
      if (superAdmins <= 1) {
        throw new ForbiddenException("系统至少需要保留一名超级管理员");
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { role: body.role },
      select: { id: true, email: true, name: true, role: true },
    });
    // 审计 M7：管理端改角色必须留痕（含变更前后）。
    await this.audit.record({
      actorId: req.user!.sub,
      actorEmail: req.user!.email,
      action: "ADMIN_ROLE_CHANGED",
      targetType: "ACCOUNT",
      targetId: id,
      metadata: { email: user.email, from: user.role, to: body.role },
    });
    return updated;
  }
}
