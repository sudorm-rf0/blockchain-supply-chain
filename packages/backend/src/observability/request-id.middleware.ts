import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");

  use(req: Request, res: Response, next: NextFunction) {
    const requestId =
      (req.headers["x-request-id"] as string) || randomUUID();
    res.setHeader("X-Request-Id", requestId);
    const start = performance.now();
    res.on("finish", () => {
      this.logger.log(
        JSON.stringify({
          level: "info",
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Number((performance.now() - start).toFixed(1)),
          requestId,
        }),
      );
    });
    next();
  }
}
