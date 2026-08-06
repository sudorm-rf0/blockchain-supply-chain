import { Module } from "@nestjs/common";
import { RedisService } from "@supply-chain/common";
import { PrismaService } from "../prisma/prisma.service";
import { IndexerService } from "./indexer.service";
import { IndexerStatusController } from "./indexer-status.controller";
import { MetricsController } from "../../../../src/shared/metrics.controller";
import { MetricsService } from "../../../../src/shared/metrics.service";
import { IndexerMetricsService } from "../observability/indexer-metrics.service";
import { RiskControlWebhookService } from "./risk-control-webhook.service";
import { SyncProcessorService } from "./sync-processor.service";
import { SyncQueueService } from "./sync-queue.service";

@Module({
  controllers: [IndexerStatusController, MetricsController],
  providers: [
    RedisService,
    PrismaService,
    MetricsService,
    IndexerMetricsService,
    SyncQueueService,
    SyncProcessorService,
    RiskControlWebhookService,
    IndexerService,
  ],
  exports: [PrismaService],
})
export class IndexerModule {}
