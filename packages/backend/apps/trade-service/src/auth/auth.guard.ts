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

// 短 TTL 内存缓存：mustChangePassword 很少变化，省掉每个请求一次用户表查询。
const USER_STATE_TTL_MS = 2_000;
const USER_STATE_CACHE_MAX = 10_000;
const userStateCache = new Map<
  string,
  { mustChangePassword: boolean; expiresAt: number }
>();

export function invalidateUserState(userId: string): void {
  userStateCache.delete(userId);
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
    const cached = userStateCache.get(payload.sub);
    let mustChangePassword: boolean;
    if (cached && cached.expiresAt > Date.now()) {
      mustChangePassword = cached.mustChangePassword;
    } else {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, mustChangePassword: true },
      });
      if (!user) {
        throw new UnauthorizedException("用户不存在");
      }
      mustChangePassword = user.mustChangePassword;
      if (userStateCache.size >= USER_STATE_CACHE_MAX) {
        const oldestKey = userStateCache.keys().next().value;
        if (oldestKey !== undefined) userStateCache.delete(oldestKey);
      }
      userStateCache.set(payload.sub, {
        mustChangePassword,
        expiresAt: Date.now() + USER_STATE_TTL_MS,
      });
    }
    if (mustChangePassword) {
      throw new ForbiddenException("请先修改初始密码");
    }
    request.user = payload;
    return true;
  }
}
