import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service";
import { SyncQueueService } from "./sync-queue.service";

@ApiTags("indexer")
@Controller("api/indexer")
export class IndexerStatusController {
  constructor(
    private readonly syncQueue: SyncQueueService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("status")
  @ApiOperation({ summary: "索引器同步状态" })
  @ApiOkResponse({ description: "队列与最近同步时间" })
  async status() {
    const [queueCounts, latestPool, latestDeal, dealCount] = await Promise.all([
      this.syncQueue.queue.getJobCounts(
        "wait",
        "active",
        "delayed",
        "failed",
      ),
      this.prisma.poolSnapshot.findFirst({
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true },
      }),
      this.prisma.tradeDeal.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      this.prisma.tradeDeal.count(),
    ]);

    return {
      service: "indexer-service",
      queue: queueCounts,
      lastPoolSnapshotAt: latestPool?.capturedAt.toISOString() ?? null,
      lastDealSyncedAt: latestDeal?.createdAt.toISOString() ?? null,
      totalDeals: dealCount,
      now: new Date().toISOString(),
    };
  }
}
