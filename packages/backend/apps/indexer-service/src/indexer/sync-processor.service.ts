import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import { Prisma, type DealStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { INDEXER_ENV } from "../config/env";
import {
  DEAL_SYNC_JOB,
  POOL_SNAPSHOT_JOB,
  DealSyncPayload,
  PoolSnapshotPayload,
} from "./payloads";
import { createBullConnection } from "./redis-connection";
import { DEAL_STATUS_BY_CODE } from "./trade-deal.parser";
import { RiskControlWebhookService } from "./risk-control-webhook.service";

const LIFECYCLE_ORDER: Record<string, number> = {
  PENDING: 0,
  FUNDED: 1,
  IN_TRANSIT: 2,
  CUSTOMS_CLEAR: 3,
  DELIVERED: 4,
  REPAYING: 5,
  SETTLED: 6,
  DEFAULTED: 7,
};

@Injectable()
export class SyncProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncProcessorService.name);
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskWebhook: RiskControlWebhookService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      INDEXER_ENV.syncQueueName,
      async (job: Job) => {
        switch (job.name) {
          case DEAL_SYNC_JOB:
            await this.handleDealSync(job.data as DealSyncPayload);
            break;
          case POOL_SNAPSHOT_JOB:
            await this.handlePoolSnapshot(job.data as PoolSnapshotPayload);
            break;
          default:
            this.logger.warn(`unknown job name: ${job.name}`);
        }
      },
      {
        connection: createBullConnection(INDEXER_ENV.redisUrl),
        concurrency: 5,
      },
    );

    this.worker.on("failed", (job, error) => {
      this.logger.error(`job ${job?.id} failed: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async handleDealSync(payload: DealSyncPayload): Promise<void> {
    const dealId = String(payload.tradeId);
    const previous = await this.prisma.tradeDeal.findUnique({
      where: { dealId },
      select: { status: true, defaultWebhookSentAt: true },
    });

    const status = (DEAL_STATUS_BY_CODE[payload.status] ??
      "PENDING") as DealStatus;

    if (previous) {
      const incomingRank = LIFECYCLE_ORDER[status] ?? -1;
      const existingRank = LIFECYCLE_ORDER[previous.status] ?? -1;
      if (incomingRank < existingRank) {
        this.logger.warn(
          `skipping deal ${payload.tradeId} sync: incoming status ${status} is behind existing ${previous.status}`,
        );
        return;
      }
    }
    const buyer = await this.upsertUser(payload.buyerWallet);
    const seller = await this.upsertUser(payload.sellerWallet);

    const data: Prisma.TradeDealCreateInput = {
      id: payload.accountKey,
      dealId: dealId,
      buyer: { connect: { id: buyer.id } },
      seller: { connect: { id: seller.id } },
      buyerWallet: payload.buyerWallet,
      sellerWallet: payload.sellerWallet,
      amount: BigInt(payload.amount),
      downPayment: BigInt(payload.downPayment),
      poolPortion: BigInt(payload.poolPortion),
      tenor: BigInt(payload.tenor),
      status,
      createdAt: new Date(Number(payload.createdAt) * 1000),
      repaidAt:
        payload.repaidAt === "0"
          ? null
          : new Date(Number(payload.repaidAt) * 1000),
      txSignature: payload.txSignature,
      logisticsHash: payload.logisticsHash,
      rawData: payload as unknown as Prisma.InputJsonValue,
    };

    const deal = await this.prisma.tradeDeal.upsert({
      where: { dealId: data.dealId },
      create: data,
      update: {
        dealId: data.dealId,
        buyer: data.buyer,
        seller: data.seller,
        buyerWallet: data.buyerWallet,
        sellerWallet: data.sellerWallet,
        amount: data.amount,
        downPayment: data.downPayment,
        poolPortion: data.poolPortion,
        tenor: data.tenor,
        status: data.status,
        createdAt: data.createdAt,
        repaidAt: data.repaidAt,
        txSignature: payload.txSignature ?? undefined,
        logisticsHash: payload.logisticsHash ?? undefined,
        rawData: data.rawData,
      },
    });

    if (
      status === "DEFAULTED" &&
      !previous?.defaultWebhookSentAt
    ) {
      const marked = await this.prisma.tradeDeal.updateMany({
        where: {
          dealId: data.dealId,
          defaultWebhookSentAt: null,
        },
        data: { defaultWebhookSentAt: new Date() },
      });
      if (marked.count > 0) {
        await this.riskWebhook.notifyDefaulted(deal);
      }
    }
  }

  private async handlePoolSnapshot(
    payload: PoolSnapshotPayload,
  ): Promise<void> {
    const capturedAt = new Date(payload.capturedAt);
    const hourStart = new Date(
      Math.floor(capturedAt.getTime() / 3_600_000) * 3_600_000,
    );

    await this.prisma.poolSnapshot.upsert({
      where: {
        poolAddress_capturedAt: {
          poolAddress: payload.poolAddress,
          capturedAt: hourStart,
        },
      },
      create: {
        poolAddress: payload.poolAddress,
        nav: BigInt(payload.nav),
        utilization: BigInt(payload.utilizationBps),
        totalAssets: BigInt(payload.totalAssets),
        activeCapital: BigInt(payload.activeCapital),
        reserveFund: BigInt(payload.reserveFund),
        insuranceFund: BigInt(payload.insuranceFund),
        pendingDividends: BigInt(payload.pendingDividends),
        capturedAt: hourStart,
      },
      update: {
        nav: BigInt(payload.nav),
        utilization: BigInt(payload.utilizationBps),
        totalAssets: BigInt(payload.totalAssets),
        activeCapital: BigInt(payload.activeCapital),
        reserveFund: BigInt(payload.reserveFund),
        insuranceFund: BigInt(payload.insuranceFund),
        pendingDividends: BigInt(payload.pendingDividends),
      },
    });
  }

  private async upsertUser(wallet: string) {
    return this.prisma.user.upsert({
      where: { wallet },
      create: { wallet },
      update: {},
    });
  }
}
