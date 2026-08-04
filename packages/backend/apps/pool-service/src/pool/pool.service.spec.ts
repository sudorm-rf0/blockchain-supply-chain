import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PoolService } from "./pool.service";

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: jest.fn(async ({ where }) => {
        if (where.id === "admin-1") {
          return { id: "admin-1", wallet: "adminWallet", role: "ADMIN" };
        }
        if (where.id === "user-1") {
          return { id: "user-1", wallet: "lpWallet", role: "USER" };
        }
        return null;
      }),
    },
    withdrawRequest: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => ({ ...data, id: "wr-1" })),
      update: jest.fn(async ({ data }) => ({ ...data })),
      findMany: jest.fn(async () => []),
    },
    ...overrides,
  };
}

function makeRedis() {
  return {
    get: jest.fn(),
    setWithExpiry: jest.fn(async () => undefined),
    setNX: jest.fn(async () => true),
    del: jest.fn(async () => undefined),
  };
}

function makeAudit() {
  return { record: jest.fn(async () => undefined) };
}

describe("PoolService", () => {
  it("rejects invalid withdrawal amounts", async () => {
    const service = new PoolService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(
      service.requestWithdrawal({ lpWallet: "lpWallet", amount: "abc" }, "user-1"),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.requestWithdrawal({ lpWallet: "lpWallet", amount: "0" }, "user-1"),
    ).rejects.toThrow(BadRequestException);
  });

  it("only lets admins execute withdrawals", async () => {
    const service = new PoolService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(
      service.executeWithdrawal("wr-1", {}, "user-1"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects execution when withdrawal is not READY", async () => {
    const prisma = makePrisma({
      withdrawRequest: {
        findUnique: jest.fn(async () => ({
          id: "wr-1",
          status: "PENDING",
        })),
      },
    });
    const service = new PoolService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(
      service.executeWithdrawal("wr-1", {}, "admin-1"),
    ).rejects.toThrow(BadRequestException);
  });

  it("releases the redis lock when the withdrawal DB write fails", async () => {
    const prisma = makePrisma({
      withdrawRequest: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => {
          throw new Error("db down");
        }),
      },
    });
    const redis = makeRedis();
    const service = new PoolService(
      prisma as never,
      redis as never,
      makeAudit() as never,
    );
    await expect(
      service.requestWithdrawal(
        { lpWallet: "lpWallet", amount: "100" },
        "user-1",
      ),
    ).rejects.toThrow("db down");
    expect(redis.del).toHaveBeenCalledWith("lp:withdraw:lpWallet");
  });

  it("releases the redis lock after an admin executes a withdrawal", async () => {
    const prisma = makePrisma({
      withdrawRequest: {
        findUnique: jest.fn(async () => ({
          id: "wr-1",
          lpAddress: "lpWallet",
          status: "READY",
        })),
        update: jest.fn(async ({ data }) => ({
          id: "wr-1",
          status: data.status,
        })),
      },
    });
    const redis = makeRedis();
    const service = new PoolService(
      prisma as never,
      redis as never,
      makeAudit() as never,
    );
    const result = await service.executeWithdrawal(
      "wr-1",
      { confirm: true },
      "admin-1",
    );
    expect(result.status).toBe("EXECUTED");
    expect(redis.del).toHaveBeenCalledWith("lp:withdraw:lpWallet");
  });

  it("rejects LP redeem amounts outside the u64 range", async () => {
    const service = new PoolService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(
      service.buildRedeemLp(
        { lpWallet: "lpWallet", lpAmount: "18446744073709551616" },
        "user-1",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("serves the cached overview from a snapshot-scoped key", async () => {
    const capturedAt = new Date("2026-08-02T15:00:00.000Z");
    const prisma = makePrisma({
      poolSnapshot: {
        findFirst: jest.fn(async () => ({
          capturedAt,
          totalAssets: 1000n,
          nav: 2n,
          activeCapital: 200n,
          reserveFund: 700n,
          insuranceFund: 100n,
          pendingDividends: 50n,
          utilization: 30n,
          poolAddress: "pool-pda",
        })),
        findMany: jest.fn(async () => []),
      },
      tradeDeal: {
        aggregate: jest.fn(async () => ({
          _count: 0,
          _sum: { amount: 0n, downPayment: 0n, poolPortion: 0n },
        })),
        groupBy: jest.fn(async () => []),
      },
    });
    const cached = { nav: "2", totalAssets: "1000" };
    const redis = makeRedis();
    (redis.get as jest.Mock).mockImplementation(async (key: string) =>
      key === "pool:overview:v1:2026-08-02T15:00:00.000Z"
        ? JSON.stringify(cached)
        : null,
    );
    const service = new PoolService(
      prisma as never,
      redis as never,
      makeAudit() as never,
    );
    const result = await service.getOverview();
    expect(result).toEqual(cached);
    expect(redis.get).toHaveBeenCalledWith(
      "pool:overview:v1:2026-08-02T15:00:00.000Z",
    );
  });

  it("falls back to the database when the overview cache is corrupted", async () => {
    const capturedAt = new Date("2026-08-02T15:00:00.000Z");
    const prisma = makePrisma({
      poolSnapshot: {
        findFirst: jest.fn(async () => ({
          capturedAt,
          totalAssets: 1000n,
          nav: 2n,
          activeCapital: 200n,
          reserveFund: 700n,
          insuranceFund: 100n,
          pendingDividends: 50n,
          utilization: 30n,
          poolAddress: "pool-pda",
        })),
        findMany: jest.fn(async () => []),
      },
      tradeDeal: {
        aggregate: jest.fn(async () => ({
          _count: 0,
          _sum: { amount: 0n, downPayment: 0n, poolPortion: 0n },
        })),
        groupBy: jest.fn(async () => []),
      },
    });
    const redis = makeRedis();
    (redis.get as jest.Mock).mockImplementation(async (key: string) =>
      key.includes("2026-08-02") ? "not-json" : null,
    );
    const service = new PoolService(
      prisma as never,
      redis as never,
      makeAudit() as never,
    );
    const result = await service.getOverview();
    expect(result.totalAssets).toBe("1000");
    expect(result.poolAddress).toBe("pool-pda");
  });

  it("rejects a withdrawal when the redis notice lock is already held", async () => {
    const redis = makeRedis();
    redis.setNX.mockResolvedValue(false);
    const service = new PoolService(
      makePrisma() as never,
      redis as never,
      makeAudit() as never,
    );
    await expect(
      service.requestWithdrawal(
        { lpWallet: "lpWallet", amount: "100" },
        "user-1",
      ),
    ).rejects.toThrow(ConflictException);
  });

  it("releases the lock when an existing pending request is found", async () => {
    const prisma = makePrisma({
      withdrawRequest: {
        findFirst: jest.fn(async () => ({ id: "existing-wr" })),
      },
    });
    const redis = makeRedis();
    const service = new PoolService(
      prisma as never,
      redis as never,
      makeAudit() as never,
    );
    await expect(
      service.requestWithdrawal(
        { lpWallet: "lpWallet", amount: "100" },
        "user-1",
      ),
    ).rejects.toThrow(ConflictException);
    expect(redis.del).toHaveBeenCalledWith("lp:withdraw:lpWallet");
  });

  it("only lets admins list withdrawals", async () => {
    const service = new PoolService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(service.listWithdrawals("user-1")).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.listWithdrawals("admin-1")).resolves.toEqual([]);
  });

  it("requires an explicit confirmation to execute a withdrawal", async () => {
    const prisma = makePrisma({
      withdrawRequest: {
        findUnique: jest.fn(async () => ({
          id: "wr-1",
          status: "READY",
        })),
        update: jest.fn(async ({ data }) => ({ ...data, id: "wr-1" })),
      },
    });
    const service = new PoolService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(
      service.executeWithdrawal("wr-1", {}, "admin-1"),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.executeWithdrawal("wr-1", { confirm: true }, "admin-1"),
    ).resolves.toMatchObject({ status: "EXECUTED" });
  });

  it("rejects withdrawal when the wallet does not match the user", async () => {
    const service = new PoolService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(
      service.requestWithdrawal(
        { lpWallet: "someone-else", amount: "100" },
        "user-1",
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("creates a withdrawal request and keeps the 7-day redis lock", async () => {
    const prisma = makePrisma({
      withdrawRequest: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }) => ({ ...data, id: "wr-1" })),
      },
    });
    const redis = makeRedis();
    const audit = makeAudit();
    const service = new PoolService(
      prisma as never,
      redis as never,
      audit as never,
    );

    const result = await service.requestWithdrawal(
      { lpWallet: "lpWallet", amount: "100" },
      "user-1",
    );

    expect(result.queueId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(prisma.withdrawRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lpAddress: "lpWallet",
          amount: expect.any(Object),
          status: "PENDING",
        }),
      }),
    );
    expect(redis.setWithExpiry).toHaveBeenCalledWith(
      "lp:withdraw:lpWallet",
      expect.stringContaining("queueId"),
      7 * 24 * 60 * 60,
    );
    expect(redis.del).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "WITHDRAW_REQUESTED" }),
    );
  });

  it("rejects withdrawal amounts above the per-request limit", async () => {
    const service = new PoolService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(
      service.requestWithdrawal(
        { lpWallet: "lpWallet", amount: "2000000" },
        "user-1",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("accepts micro-precision amounts and rejects scientific notation", async () => {
    const prisma = makePrisma({
      withdrawRequest: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }) => ({ ...data, id: "wr-1" })),
      },
    });
    const service = new PoolService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(
      service.requestWithdrawal(
        { lpWallet: "lpWallet", amount: "0.000001" },
        "user-1",
      ),
    ).resolves.toMatchObject({ status: "PENDING" });
    await expect(
      service.requestWithdrawal(
        { lpWallet: "lpWallet", amount: "1e3" },
        "user-1",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("returns not found for a missing withdrawal request", async () => {
    const service = new PoolService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(
      service.executeWithdrawal("missing-wr", { confirm: true }, "admin-1"),
    ).rejects.toThrow(NotFoundException);
  });

  it("records an audit entry when executing a confirmed withdrawal", async () => {
    const prisma = makePrisma({
      withdrawRequest: {
        findUnique: jest.fn(async () => ({
          id: "wr-1",
          status: "READY",
        })),
        update: jest.fn(async ({ data }) => ({ ...data, id: "wr-1" })),
      },
    });
    const audit = makeAudit();
    const service = new PoolService(
      prisma as never,
      makeRedis() as never,
      audit as never,
    );
    await service.executeWithdrawal("wr-1", { confirm: true }, "admin-1");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WITHDRAW_EXECUTED",
        targetType: "WITHDRAW",
        targetId: "wr-1",
      }),
    );
  });

  it("serves an empty overview without throwing", async () => {
    const prisma = makePrisma({
      poolSnapshot: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
      },
      tradeDeal: {
        aggregate: jest.fn(async () => ({
          _count: 0,
          _sum: { amount: 0n, downPayment: 0n, poolPortion: 0n },
        })),
        groupBy: jest.fn(async () => []),
      },
    });
    const redis = makeRedis();
    (redis.get as jest.Mock).mockResolvedValue(null);
    const service = new PoolService(
      prisma as never,
      redis as never,
      makeAudit() as never,
    );
    const result = await service.getOverview();
    expect(result.totalAssets).toBe("0");
    expect(result.aprPct).toBe(0);
    expect(result.activeDeals).toBe(0);
  });

  it("computes APR and the 30/70 split from snapshots", async () => {
    const capturedAt = new Date("2026-08-02T15:00:00.000Z");
    const prisma = makePrisma({
      poolSnapshot: {
        findFirst: jest.fn(async () => ({
          capturedAt,
          totalAssets: 1000n,
          nav: 10n,
          activeCapital: 700n,
          reserveFund: 200n,
          insuranceFund: 100n,
          pendingDividends: 25n,
          utilization: 7000n,
          poolAddress: "pool-pda",
        })),
        findMany: jest.fn(async () => []),
      },
      tradeDeal: {
        aggregate: jest.fn(async () => ({
          _count: 2,
          _sum: { amount: 1000n, downPayment: 300n, poolPortion: 700n },
        })),
        groupBy: jest.fn(async () => [
          { status: "SETTLED", _count: 1 },
          { status: "PENDING", _count: 1 },
        ]),
      },
    });
    const redis = makeRedis();
    (redis.get as jest.Mock).mockResolvedValue(null);
    const service = new PoolService(
      prisma as never,
      redis as never,
      makeAudit() as never,
    );
    const result = await service.getOverview();
    expect(result.aprPct).toBe(2.5);
    expect(result.downPaymentSharePct).toBe(30);
    expect(result.poolPortionSharePct).toBe(70);
    expect(result.activeDeals).toBe(1);
    expect(result.settledDeals).toBe(1);
  });

  it("rejects invalid lp amounts on redeem", async () => {
    const service = new PoolService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(
      service.buildRedeemLp({ lpWallet: "lpWallet", lpAmount: "abc" }, "user-1"),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.buildRedeemLp({ lpWallet: "lpWallet", lpAmount: "0" }, "user-1"),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects redeem when the lp wallet does not match the user", async () => {
    const service = new PoolService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(
      service.buildRedeemLp({ lpWallet: "other-wallet", lpAmount: "100" }, "user-1"),
    ).rejects.toThrow(ForbiddenException);
  });
});
