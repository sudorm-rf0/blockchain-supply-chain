import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RedisService } from "@supply-chain/common";
import { PrismaService } from "../prisma/prisma.service";
import { SyncQueueService } from "./sync-queue.service";

@ApiTags("indexer")
@Controller("api/indexer")
export class IndexerStatusController {
  private static readonly CACHE_KEY = "indexer:status:v1";
  private static readonly CACHE_TTL_SECONDS = 5;

  constructor(
    private readonly syncQueue: SyncQueueService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get("status")
  @ApiOperation({ summary: "索引器同步状态" })
  @ApiOkResponse({ description: "队列与最近同步时间" })
  async status() {
    // 5s Redis 缓存：/api/indexer/status 是压测中最慢读接口（每次 BullMQ 统计 + 3 个 Prisma 查询）。
    const cached = await this.redis.get(IndexerStatusController.CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }

    const payload = await this.computeStatus();
    await this.redis.setEx(
      IndexerStatusController.CACHE_KEY,
      IndexerStatusController.CACHE_TTL_SECONDS,
      JSON.stringify(payload),
    );
    return payload;
  }

  private async computeStatus() {
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
