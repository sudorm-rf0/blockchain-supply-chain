import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { PrismaQueryLike } from "../types";
import { verifyJwt, type JwtPayload } from "./jwt";

export const ACCESS_TOKEN_COOKIE = "access_token";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// 主后端改密流程允许访问的路径；其他服务无这些路由，白名单永不命中（等效全拒绝）。
const PASSWORD_ONLY_PATHS = new Set([
  "/api/auth/me",
  "/api/auth/change-password",
  "/api/auth/logout",
]);

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
  constructor(private readonly prisma: PrismaQueryLike) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const cookieToken = (request.cookies as Record<string, string> | undefined)?.[
      ACCESS_TOKEN_COOKIE
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
    if (mustChangePassword && !PASSWORD_ONLY_PATHS.has(request.path)) {
      throw new ForbiddenException("请先修改初始密码");
    }
    request.user = payload;
    return true;
  }
}
