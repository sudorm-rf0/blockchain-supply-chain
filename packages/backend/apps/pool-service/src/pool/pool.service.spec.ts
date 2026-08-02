import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
});
