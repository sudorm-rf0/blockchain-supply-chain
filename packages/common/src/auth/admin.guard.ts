import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { PRISMA_SERVICE, type PrismaQueryLike } from "../types";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaQueryLike,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user?.sub) {
      throw new ForbiddenException("需要管理员权限");
    }
    const user = await this.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { role: true },
    });
    // 管理员与超级管理员均视为后台管理角色
    if (user?.role !== "ADMIN" && user?.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("需要管理员权限");
    }
    return true;
  }
}
