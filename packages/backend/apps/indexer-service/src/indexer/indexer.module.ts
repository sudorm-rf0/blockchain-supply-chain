import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { IndexerService } from "./indexer.service";
import { RiskControlWebhookService } from "./risk-control-webhook.service";
import { SyncProcessorService } from "./sync-processor.service";
import { SyncQueueService } from "./sync-queue.service";

@Module({
  providers: [
    PrismaService,
    SyncQueueService,
    SyncProcessorService,
    RiskControlWebhookService,
    IndexerService,
  ],
})
export class IndexerModule {}
