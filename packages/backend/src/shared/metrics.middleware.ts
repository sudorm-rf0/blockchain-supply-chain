import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { performance } from "node:perf_hooks";
import { MetricsService } from "./metrics.service";

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = performance.now();
    res.on("finish", () => {
      this.metrics.record(
        req.method,
        req.path,
        res.statusCode,
        (performance.now() - start) / 1000,
      );
    });
    next();
  }
}
