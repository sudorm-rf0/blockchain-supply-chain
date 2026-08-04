import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Gauge } from "prom-client";
import { PrismaService } from "../prisma/prisma.service";
import { SyncQueueService } from "../indexer/sync-queue.service";
import { MetricsService } from "../../../../src/shared/metrics.service";

@Injectable()
export class IndexerMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerMetricsService.name);
  private readonly gauge: Gauge<string>;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly metrics: MetricsService,
    private readonly syncQueue: SyncQueueService,
    private readonly prisma: PrismaService,
  ) {
    this.gauge = new Gauge<string>({
      name: "indexer_queue_jobs",
      help: "Indexer BullMQ jobs by status",
      labelNames: ["status"],
      registers: [this.metrics.registry],
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
      const counts = await this.syncQueue.queue.getJobCounts(
        "wait",
        "active",
        "delayed",
        "failed",
      );
      for (const [status, value] of Object.entries(counts)) {
        this.gauge.set({ status }, value);
      }
      const totalDeals = await this.prisma.tradeDeal.count();
      this.gauge.set({ status: "total_deals" }, totalDeals);
    } catch (error) {
      this.logger.error(`failed to update indexer metrics: ${String(error)}`);
    }
  }
}
