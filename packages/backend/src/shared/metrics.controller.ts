import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Req,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { MetricsService } from "./metrics.service";

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

@SkipThrottle()
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4")
  async getMetrics(@Req() req: Request) {
    // 审计 M2：/metrics 仅允许本机或显式白名单 IP 访问，避免内网信息泄露。
    const allowed = new Set(LOOPBACK_IPS);
    for (const ip of (process.env.METRICS_ALLOWED_IPS ?? "").split(",")) {
      const trimmed = ip.trim();
      if (trimmed) allowed.add(trimmed);
    }
    const ip = req.ip ?? "";
    if (!allowed.has(ip)) {
      throw new ForbiddenException("metrics 仅允许本机/白名单 IP 访问");
    }
    return this.metrics.metrics();
  }
}
