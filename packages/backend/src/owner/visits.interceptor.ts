import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { VisitLogService } from "./visit-log.service";

const SKIP_PREFIXES = ["/health", "/health/ready", "/api/admin/owner", "/api-docs", "/api/csp-report"];
const SKIP_EXACT = new Set(["/favicon.ico", "/robots.txt", "/sw.js", "/manifest.webmanifest"]);

/** 全局访问记录拦截器：静默记录访客 IP / UA / 路径 / 状态 / 耗时，失败不影响业务 */
@Injectable()
export class VisitsInterceptor implements NestInterceptor {
  constructor(private readonly visits: VisitLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest();
    const method = (req.method ?? "GET").toUpperCase();
    const path: string = req.path ?? req.url ?? "";
    if (method === "OPTIONS") {
      return next.handle();
    }
    if (SKIP_EXACT.has(path) || SKIP_PREFIXES.some((p) => path.startsWith(p))) {
      return next.handle();
    }
    const start = Date.now();
    const meta = {
      ip: (req.ip as string | undefined) ?? req.socket?.remoteAddress,
      userAgent: (req.headers?.["user-agent"] as string | undefined) ?? "",
      path,
      method,
      referrer: (req.headers?.["referer"] as string | undefined) ?? "",
      userId: (req.user as { sub?: string } | undefined)?.sub,
    };
    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse();
          void this.visits.record({
            ...meta,
            statusCode: res.statusCode,
            durationMs: Date.now() - start,
          });
        },
        error: () => {
          const res = context.switchToHttp().getResponse();
          void this.visits.record({
            ...meta,
            statusCode: res.statusCode || 500,
            durationMs: Date.now() - start,
          });
        },
      }),
    );
  }
}
