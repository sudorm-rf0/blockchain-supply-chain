import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DealStatus, Prisma } from "@prisma/client";
import { Connection, PublicKey } from "@solana/web3.js";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "@supply-chain/common";
import { AuditService } from "../audit/audit.service";
import {
  buildRedeemLpInstructionData,
  buildRedeemLpTransaction,
  deriveLpAta,
  derivePoolStatePda,
  deriveUsdcAta,
} from "../lp/redeem-lp.builder";
import { POOL_ENV } from "../config/env";
import { PoolOverviewResponseDto } from "./dto/pool-overview-response.dto";
import { WithdrawRequestDto } from "./dto/withdraw-request.dto";
import { WithdrawRequestResponseDto } from "./dto/withdraw-request-response.dto";

const NOTICE_DAYS = 7;
const NOTICE_SECONDS = NOTICE_DAYS * 24 * 60 * 60;
const U64_MAX = (1n << 64n) - 1n;
const OVERVIEW_CACHE_KEY = "pool:overview:v1";
const OVERVIEW_CACHE_SECONDS = 30;
let _connection: Connection | undefined;

function getConnection(): Connection {
  return (_connection ??= new Connection(POOL_ENV.rpcUrl, "confirmed"));
}
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
    private readonly audit: AuditService,
  ) {}

  async getOverview(): Promise<PoolOverviewResponseDto> {
    const latest = await this.prisma.poolSnapshot.findFirst({
      orderBy: { capturedAt: "desc" },
    });
    const cacheKey = latest
      ? `${OVERVIEW_CACHE_KEY}:${latest.capturedAt.toISOString()}`
      : `${OVERVIEW_CACHE_KEY}:empty`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as PoolOverviewResponseDto;
      } catch {
        // 缓存损坏时忽略并重新计算。
      }
    }

    const [recent, dealAgg, dealGroups, activeAgg] = await Promise.all([
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
      this.prisma.tradeDeal.aggregate({
        where: { status: { in: [...ACTIVE_STATUSES] as DealStatus[] } },
        _sum: { amount: true },
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

    const overview: PoolOverviewResponseDto = {
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
      outstandingAmount: (activeAgg._sum?.amount ?? 0n).toString(10),
      trend: [...recent]
        .reverse()
        .map((snapshot) => ({
          capturedAt: snapshot.capturedAt.toISOString(),
          nav: snapshot.nav.toString(10),
          totalAssets: snapshot.totalAssets.toString(10),
          activeCapital: snapshot.activeCapital.toString(10),
          idle: (
            snapshot.totalAssets > snapshot.activeCapital
              ? snapshot.totalAssets - snapshot.activeCapital
              : 0n
          ).toString(10),
          utilizationBps: Number(snapshot.utilization ?? 0n),
        })),
    };
    await this.redis.setWithExpiry(
      cacheKey,
      JSON.stringify(overview),
      OVERVIEW_CACHE_SECONDS,
    );
    return overview;
  }

  async requestWithdrawal(
    dto: WithdrawRequestDto,
    userId: string,
  ): Promise<WithdrawRequestResponseDto> {
    if (!/^\d+(\.\d{1,6})?$/.test(dto.amount)) {
      throw new BadRequestException("invalid withdrawal amount");
    }
    const amountValue = new Prisma.Decimal(dto.amount);
    if (amountValue.lte(0)) {
      throw new BadRequestException("withdrawal amount must be positive");
    }
    if (amountValue.gt(POOL_ENV.maxWithdrawUsdc)) {
      throw new BadRequestException(
        `withdrawal amount exceeds the per-request limit of ${POOL_ENV.maxWithdrawUsdc} USDC`,
      );
    }

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
    let lockAcquired: boolean;
    try {
      lockAcquired = await this.redis.setNX(key, "locked", NOTICE_SECONDS);
    } catch {
      throw new ServiceUnavailableException("服务暂时不可用，请稍后重试");
    }
    if (!lockAcquired) {
      throw new ConflictException(
        "withdrawal already requested within the 7-day notice period",
      );
    }

    const existingDb = await this.prisma.withdrawRequest.findFirst({
      where: {
        lpAddress: dto.lpWallet,
        status: { in: ["PENDING", "READY"] },
      },
      select: { id: true },
    });
    if (existingDb) {
      await this.redis.del(key);
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

    try {
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
    } catch (error) {
      await this.redis.del(key).catch(() => undefined);
      throw error;
    }
    await this.redis.setWithExpiry(key, value, NOTICE_SECONDS);
    await this.audit.record({
      actorId: userId,
      action: "WITHDRAW_REQUESTED",
      targetType: "WITHDRAW",
      targetId: queueId,
      metadata: { lpWallet: dto.lpWallet, amount: dto.amount },
    });

    return {
      queueId,
      status: "PENDING",
      noticeDays: NOTICE_DAYS,
      unlockAt: unlockAt.toISOString(),
    };
  }

  async executeWithdrawal(
    id: string,
    body: { txSignature?: string; confirm?: boolean },
    userId: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "ADMIN") {
      throw new ForbiddenException("仅管理员可执行提款");
    }
    const request = await this.prisma.withdrawRequest.findUnique({
      where: { id },
    });
    if (!request) {
      throw new NotFoundException("withdrawal request not found");
    }
    if (body.confirm !== true) {
      throw new BadRequestException("请二次确认后执行提款");
    }
    if (request.status !== "READY") {
      throw new BadRequestException("仅 READY 状态的提款可执行");
    }
    const updated = await this.prisma.withdrawRequest.update({
      where: { id },
      data: { status: "EXECUTED" },
    });
    await this.redis
      .del(`lp:withdraw:${request.lpAddress}`)
      .catch(() => undefined);
    await this.audit.record({
      actorId: userId,
      action: "WITHDRAW_EXECUTED",
      targetType: "WITHDRAW",
      targetId: id,
      metadata: { txSignature: body.txSignature ?? null },
    });
    return { ok: true, id: updated.id, status: updated.status };
  }

  async buildRedeemLp(
    dto: { lpWallet: string; lpAmount: string },
    userId: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.wallet !== dto.lpWallet) {
      throw new ForbiddenException("lp wallet does not match the signed-in user");
    }
    let lpAmount: bigint;
    try {
      lpAmount = BigInt(dto.lpAmount);
      if (lpAmount <= 0n || lpAmount > U64_MAX) {
        throw new Error("out of range");
      }
    } catch {
      throw new BadRequestException("invalid lpAmount");
    }
    const { transaction, blockhash } = await buildRedeemLpTransaction(
      new PublicKey(dto.lpWallet),
      lpAmount,
      getConnection(),
    );
    return {
      transaction: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      blockhash,
      message: "请确认钱包弹窗，签署 LP 赎回交易",
    };
  }

  async confirmRedeemLp(
    dto: { lpAmount: string; txSignature: string },
    userId: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.wallet) {
      throw new ForbiddenException("登录用户未绑定钱包");
    }
    let lpAmount: bigint;
    try {
      lpAmount = BigInt(dto.lpAmount);
      if (lpAmount <= 0n || lpAmount > U64_MAX) {
        throw new Error("out of range");
      }
    } catch {
      throw new BadRequestException("invalid lpAmount");
    }

    let tx;
    try {
      tx = await getConnection().getTransaction(dto.txSignature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      throw new BadRequestException("交易签名无效或尚未上链");
    }
    if (!tx || tx.meta?.err) {
      throw new BadRequestException("交易未在链上确认");
    }
    const message = tx.transaction.message as {
      accountKeys?: PublicKey[];
      staticAccountKeys?: PublicKey[];
      compiledInstructions: Array<{
        programIdIndex: number;
        accountKeyIndexes: number[];
        data: Uint8Array;
      }>;
    };
    const accountKeys = message.accountKeys ?? message.staticAccountKeys ?? [];
    const programId = new PublicKey(POOL_ENV.programId);
    const expectedData = buildRedeemLpInstructionData(lpAmount);
    const lpUser = new PublicKey(user.wallet);
    const expectedAccounts = [
      deriveLpAta(lpUser).toBase58(),
      deriveUsdcAta(lpUser).toBase58(),
      derivePoolStatePda().toBase58(),
      new PublicKey(POOL_ENV.lpMint).toBase58(),
    ];
    const hasRedeem = message.compiledInstructions.some((instruction) => {
      const instructionKeys = instruction.accountKeyIndexes.map(
        (index: number) => accountKeys[index],
      );
      return (
        accountKeys[instruction.programIdIndex]?.equals(programId) &&
        Buffer.compare(Buffer.from(instruction.data), expectedData) === 0 &&
        expectedAccounts.every((account) =>
          instructionKeys.some((key: PublicKey | undefined) => key?.toBase58() === account),
        )
      );
    });
    if (!hasRedeem) {
      throw new BadRequestException("交易不包含预期的 redeem_lp 指令或账户不匹配");
    }

    const id = randomUUID();
    await this.prisma.withdrawRequest.create({
      data: {
        id,
        lpAddress: user.wallet,
        amount: new Prisma.Decimal(lpAmount.toString()).div(1_000_000),
        requestedAt: new Date(),
        availableAt: new Date(),
        status: "EXECUTED",
      },
    });
    await this.audit.record({
      actorId: userId,
      action: "LP_REDEEMED",
      targetType: "WITHDRAW",
      targetId: id,
      metadata: { lpAmount: dto.lpAmount, txSignature: dto.txSignature },
    });
    return { ok: true, id, status: "EXECUTED" };
  }

  async listWithdrawals(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "ADMIN") {
      throw new ForbiddenException("仅管理员可查看提款列表");
    }
    const requests = await this.prisma.withdrawRequest.findMany({
      orderBy: { requestedAt: "desc" },
      take: 200,
    });
    return requests.map((request) => ({
      id: request.id,
      lpAddress: request.lpAddress,
      amount: request.amount.toString(),
      requestedAt: request.requestedAt.toISOString(),
      availableAt: request.availableAt.toISOString(),
      status: request.status,
    }));
  }
}
