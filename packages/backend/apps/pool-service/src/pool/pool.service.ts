import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { PoolOverviewResponseDto } from "./dto/pool-overview-response.dto";
import { WithdrawRequestDto } from "./dto/withdraw-request.dto";
import { WithdrawRequestResponseDto } from "./dto/withdraw-request-response.dto";

const NOTICE_DAYS = 7;
const NOTICE_SECONDS = NOTICE_DAYS * 24 * 60 * 60;
const ACTIVE_STATUSES = new Set([
  "PENDING",
  "FUNDED",
  "IN_TRANSIT",
  "CUSTOMS_CLEAR",
  "DELIVERED",
  "REPAYING",
]);

@Injectable()
export class PoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getOverview(): Promise<PoolOverviewResponseDto> {
    const [latest, recent, dealAgg, dealGroups] = await Promise.all([
      this.prisma.poolSnapshot.findFirst({
        orderBy: { capturedAt: "desc" },
      }),
      this.prisma.poolSnapshot.findMany({
        orderBy: { capturedAt: "desc" },
        take: 24,
      }),
      this.prisma.tradeDeal.aggregate({
        _count: true,
        _sum: {
          amount: true,
          downPayment: true,
          poolPortion: true,
        },
      }),
      this.prisma.tradeDeal.groupBy({
        by: ["status"],
        _count: true,
      }),
    ]);

    const totalAssets = latest?.totalAssets ?? 0n;
    const pendingDividends = latest?.pendingDividends ?? 0n;
    const aprPct =
      totalAssets > 0n
        ? Number((pendingDividends * 100_00n) / totalAssets) / 100
        : 0;

    const downPaymentSum = dealAgg._sum.downPayment ?? 0n;
    const poolPortionSum = dealAgg._sum.poolPortion ?? 0n;
    const splitTotal = downPaymentSum + poolPortionSum;
    const downPaymentSharePct =
      splitTotal > 0n
        ? Number((downPaymentSum * 100_00n) / splitTotal) / 100
        : 0;
    const poolPortionSharePct =
      splitTotal > 0n
        ? Number((poolPortionSum * 100_00n) / splitTotal) / 100
        : 0;

    let activeDeals = 0;
    let settledDeals = 0;
    let defaultedDeals = 0;
    for (const group of dealGroups) {
      if (group.status === "SETTLED") {
        settledDeals += group._count;
      } else if (group.status === "DEFAULTED") {
        defaultedDeals += group._count;
      } else if (ACTIVE_STATUSES.has(group.status)) {
        activeDeals += group._count;
      }
    }

    return {
      poolAddress: latest?.poolAddress ?? "",
      nav: (latest?.nav ?? 0n).toString(10),
      totalAssets: totalAssets.toString(10),
      activeCapital: (latest?.activeCapital ?? 0n).toString(10),
      reserveFund: (latest?.reserveFund ?? 0n).toString(10),
      insuranceFund: (latest?.insuranceFund ?? 0n).toString(10),
      pendingDividends: pendingDividends.toString(10),
      utilizationBps: Number(latest?.utilization ?? 0n),
      aprPct,
      downPaymentSharePct,
      poolPortionSharePct,
      totalDeals: dealAgg._count,
      activeDeals,
      settledDeals,
      defaultedDeals,
      outstandingAmount: (dealAgg._sum.amount ?? 0n).toString(10),
      trend: [...recent]
        .reverse()
        .map((snapshot) => ({
          capturedAt: snapshot.capturedAt.toISOString(),
          nav: snapshot.nav.toString(10),
          totalAssets: snapshot.totalAssets.toString(10),
        })),
    };
  }

  async requestWithdrawal(
    dto: WithdrawRequestDto,
    userId: string,
  ): Promise<WithdrawRequestResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new ForbiddenException("登录用户不存在");
    }
    if (user.wallet !== dto.lpWallet) {
      throw new ForbiddenException(
        "lp wallet does not match the signed-in user",
      );
    }

    const key = `lp:withdraw:${dto.lpWallet}`;
    const existing = await this.redis.get(key);
    const existingDb = await this.prisma.withdrawRequest.findFirst({
      where: {
        lpAddress: dto.lpWallet,
        status: { in: ["PENDING", "READY"] },
      },
      select: { id: true },
    });
    if (existing || existingDb) {
      throw new ConflictException(
        "withdrawal already requested within the 7-day notice period",
      );
    }

    const queueId = randomUUID();
    const now = new Date();
    const unlockAt = new Date(now.getTime() + NOTICE_SECONDS * 1000);
    const value = JSON.stringify({
      queueId,
      lpWallet: dto.lpWallet,
      amount: dto.amount,
      poolAddress: dto.poolAddress ?? "",
      requestedAt: now.toISOString(),
      unlockAt: unlockAt.toISOString(),
      status: "PENDING",
    });

    await this.prisma.withdrawRequest.create({
      data: {
        id: queueId,
        lpAddress: dto.lpWallet,
        amount: new Prisma.Decimal(dto.amount),
        requestedAt: now,
        availableAt: unlockAt,
        status: "PENDING",
      },
    });
    await this.redis.setWithExpiry(key, value, NOTICE_SECONDS);

    return {
      queueId,
      status: "PENDING",
      noticeDays: NOTICE_DAYS,
      unlockAt: unlockAt.toISOString(),
    };
  }
}
