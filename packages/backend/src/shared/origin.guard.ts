import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";

const LOCALHOST_ORIGIN = /^https?:\/\/localhost(:\d+)?$/;
/** 无需 Origin 校验的变更端点（浏览器 CSP report-uri 自动上报，可能不带 Origin）。 */
const NO_ORIGIN_EXEMPT_PATHS = new Set(["/api/csp-report"]);
/** 环回地址：本机脚本/CI/e2e（Node fetch 不带 Origin）视为可信客户端。 */
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      return true;
    }

    const origin = request.headers.origin;
    // 审计 M1：CSRF 纵深防御——变更请求必须携带 Origin。
    // 无 Origin 时仅放行：显式豁免路径（CSP report）与本机客户端（脚本/CI/e2e）；
    // 远程无 Origin 的变更请求一律拒绝。
    if (!origin) {
      if (NO_ORIGIN_EXEMPT_PATHS.has(request.path)) {
        return true;
      }
      const ip = request.ip ?? "";
      if (LOOPBACK_IPS.has(ip)) {
        return true;
      }
      throw new ForbiddenException("缺少 Origin，跨域请求被拒绝");
    }

    const sameOrigin =
      typeof request.headers.host === "string" &&
      origin.startsWith(`${request.protocol}://${request.headers.host}`);
    const allowedOrigins = [
      LOCALHOST_ORIGIN,
      process.env.ALLOWED_ORIGIN,
    ].filter(Boolean) as (string | RegExp)[];
    const allowed = allowedOrigins.some((candidate) =>
      typeof candidate === "string"
        ? candidate === origin
        : candidate.test(origin),
    );
    if (!sameOrigin && !allowed) {
      throw new ForbiddenException("跨域请求被拒绝");
    }
    return true;
  }
}
