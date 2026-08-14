import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { unlink } from "node:fs/promises";
import type { Request } from "express";
import { Observable, catchError, throwError } from "rxjs";

/**
 * 审计专项测试发现（2026-08-14）：
 * multer 在 handler 之前完成落盘，若后续 DTO 校验（如 description 超长）
 * 或业务校验抛错，已写入磁盘的文件不会被清理，导致无 DB 记录的残留文件
 * 累积，可被已登录用户反复触发 → 磁盘填充 DoS。
 * 该 interceptor 捕获下游异常并删除本次上传落盘的文件（幂等，删除失败静默）。
 */
@Injectable()
export class CleanupUploadedFilesInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error) => {
        const request = context
          .switchToHttp()
          .getRequest<Request & { file?: { path?: string } }>();
        if (request.file?.path) {
          void unlink(request.file.path).catch(() => undefined);
        }
        return throwError(() => error);
      }),
    );
  }
}
