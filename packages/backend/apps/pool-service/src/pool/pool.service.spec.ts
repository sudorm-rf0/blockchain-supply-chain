import {
  BadRequestException,
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
    get: jest.fn(async () => null),
    setWithExpiry: jest.fn(async () => undefined),
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
