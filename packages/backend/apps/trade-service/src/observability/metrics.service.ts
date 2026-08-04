import { Injectable } from "@nestjs/common";
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly requests: Counter;
  private readonly duration: Histogram;

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
  }

  get registryRef() {
    return this.registry;
  }

  record(method: string, path: string, status: number, seconds: number) {
    const labels = { method, path, status: String(status) };
    this.requests.inc(labels);
    this.duration.observe(labels, seconds);
  }

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
