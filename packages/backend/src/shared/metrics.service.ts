import { Injectable } from "@nestjs/common";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import {
  getRedisFailureCount,
  getRedisLastFailureAt,
} from "@supply-chain/common";

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  private readonly requests: Counter;
  private readonly duration: Histogram;
  private readonly cspViolations: Counter;
  private readonly redisFailures: Gauge;
  private readonly redisLastFailureAt: Gauge;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.requests = new Counter({
      name: "http_requests_total",
      help: "Total HTTP requests",
      labelNames: ["method", "path", "status"],
      registers: [this.registry],
    });
    this.duration = new Histogram({
      name: "http_request_duration_seconds",
      help: "HTTP request duration in seconds",
      labelNames: ["method", "path", "status"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    this.cspViolations = new Counter({
      name: "csp_violations_total",
      help: "Total CSP violation reports received from browsers",
      labelNames: ["directive", "disposition"],
      registers: [this.registry],
    });
    // OFF-REDIS-1：Redis 操作失败计数（模块级共享，跨服务实例一致）。
    // >0 表示出现过失败（incr 失败 = 登录防暴破 fail-open），供告警联动。
    this.redisFailures = new Gauge({
      name: "redis_operation_failures",
      help: "Total Redis operation failures observed by this process",
      registers: [this.registry],
      collect: () => {
        this.redisFailures.set(getRedisFailureCount());
      },
    });
    this.redisLastFailureAt = new Gauge({
      name: "redis_last_failure_timestamp_seconds",
      help: "Unix timestamp (seconds) of the last Redis operation failure, 0 if none",
      registers: [this.registry],
      collect: () => {
        const last = getRedisLastFailureAt();
        this.redisLastFailureAt.set(last ? last / 1000 : 0);
      },
    });
  }

  record(method: string, path: string, status: number, seconds: number) {
    const labels = { method, path, status: String(status) };
    this.requests.inc(labels);
    this.duration.observe(labels, seconds);
  }

  recordCspViolation(directive: string, disposition: string) {
    this.cspViolations.inc({ directive, disposition });
  }

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
