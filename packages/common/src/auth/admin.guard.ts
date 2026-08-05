import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import type { PrismaQueryLike } from "../types";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaQueryLike) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user?.sub) {
      throw new ForbiddenException("需要管理员权限");
    }
    const user = await this.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { role: true },
    });
    if (user?.role !== "ADMIN") {
      throw new ForbiddenException("需要管理员权限");
    }
    return true;
  }
}
