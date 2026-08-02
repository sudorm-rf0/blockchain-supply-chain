import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { IndexerService } from "./indexer.service";
import { IndexerStatusController } from "./indexer-status.controller";
import { RiskControlWebhookService } from "./risk-control-webhook.service";
import { SyncProcessorService } from "./sync-processor.service";
import { SyncQueueService } from "./sync-queue.service";

@Module({
  controllers: [IndexerStatusController],
  providers: [
    PrismaService,
    SyncQueueService,
    SyncProcessorService,
    RiskControlWebhookService,
    IndexerService,
  ],
  exports: [PrismaService],
})
export class IndexerModule {}
