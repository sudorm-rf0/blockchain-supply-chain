import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Gauge } from "prom-client";
import { PrismaService } from "../prisma/prisma.service";
import { MetricsService } from "../observability/metrics.service";

@Injectable()
export class TradeMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly gauge: Gauge<string>;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
  ) {
    this.gauge = new Gauge<string>({
      name: "trade_deals_total",
      help: "Trade deals by status",
      labelNames: ["status"],
      registers: [this.metrics.registryRef],
    });
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.update(), 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async update(): Promise<void> {
    try {
      const groups = await this.prisma.tradeDeal.groupBy({
        by: ["status"],
        _count: true,
      });
      for (const group of groups) {
        this.gauge.set({ status: group.status }, group._count);
      }
      this.gauge.set(
        { status: "TOTAL" },
        await this.prisma.tradeDeal.count(),
      );
    } catch {
      // 指标刷新失败不影响业务。
    }
  }
}
