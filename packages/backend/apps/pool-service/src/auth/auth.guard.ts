import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { verifyJwt, type JwtPayload } from "./jwt";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const cookieToken = (request.cookies as Record<string, string> | undefined)?.[
      "access_token"
    ];
    const header = request.headers.authorization;
    const bearerToken =
      header && header.startsWith("Bearer ") ? header.slice(7) : undefined;
    const token = cookieToken ?? bearerToken;
    if (!token) {
      throw new UnauthorizedException("未登录");
    }
    const payload = verifyJwt(token);
    if (!payload) {
      throw new UnauthorizedException("登录已过期");
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, mustChangePassword: true },
    });
    if (!user) {
      throw new UnauthorizedException("用户不存在");
    }
    if (user.mustChangePassword) {
      throw new ForbiddenException("请先修改初始密码");
    }
    request.user = payload;
    return true;
  }
}
