import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";

const LOCALHOST_ORIGIN = /^https?:\/\/localhost(:\d+)?$/;

@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      return true;
    }

    const origin = request.headers.origin;
    if (!origin) {
      return true;
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
