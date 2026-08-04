import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { TradesService } from "./trades.service";

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: jest.fn(async ({ where }) => {
        if (where.id === "admin-1") {
          return { id: "admin-1", wallet: "adminWallet", role: "ADMIN" };
        }
        if (where.id === "user-1") {
          return { id: "user-1", wallet: "buyerWallet", role: "USER" };
        }
        return null;
      }),
    },
    tradeDeal: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async ({ create }) => ({ ...create, status: "PENDING" })),
      update: jest.fn(async ({ data }) => ({ ...data })),
      findMany: jest.fn(async () => []),
    },
    ...overrides,
  };
}

function makeRedis() {
  return {
    setNX: jest.fn(async () => true),
    del: jest.fn(async () => undefined),
  };
}

function makeAudit() {
  return { record: jest.fn(async () => undefined) };
}

describe("TradesService", () => {
  it("rejects non-matching buyer wallets on create", async () => {
    const prisma = makePrisma();
    const service = new TradesService(prisma as never, makeAudit() as never, makeRedis() as never);
    await expect(
      service.createTrade(
        {
          buyerWallet: "other",
          sellerWallet: "seller",
          amount: "100",
          tenor: "30",
        },
        "user-1",
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects invalid tenor on create", async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn(async () => ({
          id: "user-1",
          wallet: "buyerWallet",
          role: "USER",
        })),
      },
    });
    const service = new TradesService(prisma as never, makeAudit() as never, makeRedis() as never);
    await expect(
      service.createTrade(
        {
          buyerWallet: "buyerWallet",
          sellerWallet: "sellerWallet",
          amount: "100",
          tenor: "15",
        },
        "user-1",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("returns existing non-PENDING status idempotently", async () => {
    const prisma = makePrisma({
      tradeDeal: {
        findUnique: jest.fn(async () => ({
          id: "deal-pda",
          status: "FUNDED",
        })),
      },
    });
    const service = new TradesService(prisma as never, makeAudit() as never, makeRedis() as never);
    const result = await service.confirmTrade(
      "1",
      {
        buyerWallet: "buyerWallet",
        sellerWallet: "sellerWallet",
        amount: "100",
        tenor: "30",
        txSignature: "sig",
      },
      "user-1",
    );
    expect(result.status).toBe("FUNDED");
  });

  it("only lets admins list all trades", async () => {
    const prisma = makePrisma();
    const service = new TradesService(prisma as never, makeAudit() as never, makeRedis() as never);
    await expect(service.listAllTrades("user-1")).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.listAllTrades("admin-1")).resolves.toEqual([]);
  });

  it("returns the existing pending deal instead of building a new transaction", async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn(async () => ({
          id: "user-1",
          wallet: "CxnwqG86ibkHhmNSrcCCbUTmmWvTTQZZddgb7d5YNxtV",
          role: "USER",
        })),
      },
      tradeDeal: {
        findFirst: jest.fn(async () => ({ dealId: "123456789" })),
      },
    });
    const service = new TradesService(
      prisma as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    const result = await service.createTrade(
      {
        buyerWallet: "CxnwqG86ibkHhmNSrcCCbUTmmWvTTQZZddgb7d5YNxtV",
        sellerWallet: "sellerWallet",
        amount: "100",
        tenor: "30",
      },
      "user-1",
    );
    expect(result.duplicate).toBe(true);
    expect(result.tradeId).toBe("123456789");
  });

  it("rejects concurrent duplicate confirmations with a lock conflict", async () => {
    const redis = makeRedis();
    redis.setNX.mockResolvedValue(false);
    const service = new TradesService(
      makePrisma() as never,
      makeAudit() as never,
      redis as never,
    );
    await expect(
      service.confirmTrade(
        "1",
        {
          buyerWallet: "buyerWallet",
          sellerWallet: "sellerWallet",
          amount: "100",
          tenor: "30",
          txSignature: "sig",
        },
        "user-1",
      ),
    ).rejects.toThrow(ConflictException);
  });

  it("rejects malformed trade ids on confirm", async () => {
    const service = new TradesService(
      makePrisma() as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await expect(
      service.confirmTrade(
        "not-a-number",
        {
          buyerWallet: "buyerWallet",
          sellerWallet: "sellerWallet",
          amount: "100",
          tenor: "30",
          txSignature: "sig",
        },
        "user-1",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects zero amount on create", async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn(async () => ({
          id: "user-1",
          wallet: "buyerWallet",
          role: "USER",
        })),
      },
    });
    const service = new TradesService(
      prisma as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await expect(
      service.createTrade(
        {
          buyerWallet: "buyerWallet",
          sellerWallet: "sellerWallet",
          amount: "0",
          tenor: "30",
        },
        "user-1",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects create when the signed-in user does not exist", async () => {
    const service = new TradesService(
      makePrisma() as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await expect(
      service.createTrade(
        {
          buyerWallet: "buyerWallet",
          sellerWallet: "sellerWallet",
          amount: "100",
          tenor: "30",
        },
        "ghost-user",
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects confirm fund when the deal is not PENDING", async () => {
    const prisma = makePrisma({
      tradeDeal: {
        findUnique: jest.fn(async () => ({
          id: "deal-pda",
          dealId: "1",
          status: "FUNDED",
          buyerWallet: "buyerWallet",
        })),
      },
    });
    const service = new TradesService(
      prisma as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await expect(
      service.confirmFundTrade("1", { txSignature: "sig" }, "admin-1"),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects repay when the deal is not REPAYING", async () => {
    const prisma = makePrisma({
      tradeDeal: {
        findUnique: jest.fn(async () => ({
          id: "deal-pda",
          dealId: "1",
          status: "FUNDED",
          buyerWallet: "buyerWallet",
        })),
      },
    });
    const service = new TradesService(
      prisma as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await expect(
      service.confirmRepayTrade("1", { txSignature: "sig" }, "user-1"),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects advancing from an unsupported status", async () => {
    const prisma = makePrisma({
      tradeDeal: {
        findUnique: jest.fn(async () => ({
          id: "deal-pda",
          dealId: "1",
          status: "SETTLED",
          buyerWallet: "buyerWallet",
        })),
      },
    });
    const service = new TradesService(
      prisma as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await expect(
      service.confirmAdvanceTrade(
        "1",
        { txSignature: "sig", targetStatus: "2", adminWallet: "adminWallet" },
        "admin-1",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects building a fund transaction with an invalid admin wallet", async () => {
    const prisma = makePrisma({
      tradeDeal: {
        findUnique: jest.fn(async () => ({
          id: "deal-pda",
          dealId: "1",
          status: "PENDING",
          buyerWallet: "buyerWallet",
        })),
      },
    });
    const service = new TradesService(
      prisma as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await expect(
      service.buildFundTrade("1", { adminWallet: "not-a-wallet" }, "admin-1"),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects confirm with a negative trade id", async () => {
    const service = new TradesService(
      makePrisma() as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await expect(
      service.confirmTrade(
        "-1",
        {
          buyerWallet: "buyerWallet",
          sellerWallet: "sellerWallet",
          amount: "100",
          tenor: "30",
          txSignature: "sig",
        },
        "user-1",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("returns an existing PENDING deal idempotently on confirm", async () => {
    const prisma = makePrisma({
      tradeDeal: {
        findUnique: jest.fn(async () => ({
          id: "deal-pda",
          status: "PENDING",
        })),
      },
    });
    const service = new TradesService(
      prisma as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    const result = await service.confirmTrade(
      "1",
      {
        buyerWallet: "buyerWallet",
        sellerWallet: "sellerWallet",
        amount: "100",
        tenor: "30",
        txSignature: "sig",
      },
      "user-1",
    );
    expect(result.status).toBe("PENDING");
  });

  it("returns a trade for an admin and blocks unrelated users", async () => {
    const prisma = makePrisma({
      tradeDeal: {
        findUnique: jest.fn(async () => ({
          id: "deal-pda",
          dealId: "1",
          buyerWallet: "buyerWallet",
          sellerWallet: "sellerWallet",
          amount: 1000n,
          downPayment: 300n,
          poolPortion: 700n,
          tenor: 2592000n,
          status: "PENDING",
          txSignature: null,
          logisticsHash: null,
          createdAt: new Date(),
        })),
      },
    });
    const service = new TradesService(
      prisma as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    const result = await service.getTrade("1", "admin-1");
    expect(result.tradeId).toBe("1");
    expect(result.status).toBe("PENDING");
    await expect(service.getTrade("1", "ghost-user")).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("returns not found for a missing trade detail", async () => {
    const service = new TradesService(
      makePrisma() as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await expect(service.getTrade("999", "admin-1")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects building a default transaction for a non-admin", async () => {
    const prisma = makePrisma({
      tradeDeal: {
        findUnique: jest.fn(async () => ({
          id: "deal-pda",
          dealId: "1",
          status: "FUNDED",
          buyerWallet: "buyerWallet",
        })),
      },
    });
    const service = new TradesService(
      prisma as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await expect(
      service.buildDefaultTrade(
        "1",
        { adminWallet: "adminWallet" },
        "user-1",
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects defaulting a settled deal", async () => {
    const prisma = makePrisma({
      tradeDeal: {
        findUnique: jest.fn(async () => ({
          id: "deal-pda",
          dealId: "1",
          status: "SETTLED",
          buyerWallet: "buyerWallet",
        })),
      },
    });
    const service = new TradesService(
      prisma as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await expect(
      service.buildDefaultTrade(
        "1",
        { adminWallet: "adminWallet" },
        "admin-1",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects building a repay transaction for a non-buyer", async () => {
    const prisma = makePrisma({
      tradeDeal: {
        findUnique: jest.fn(async () => ({
          id: "deal-pda",
          dealId: "1",
          status: "REPAYING",
          buyerWallet: "someone-else",
        })),
      },
    });
    const service = new TradesService(
      prisma as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await expect(service.buildRepayTrade("1", "user-1")).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("rejects confirming a fund for a non-admin", async () => {
    const prisma = makePrisma({
      tradeDeal: {
        findUnique: jest.fn(async () => ({
          id: "deal-pda",
          dealId: "1",
          status: "PENDING",
          buyerWallet: "buyerWallet",
        })),
      },
    });
    const service = new TradesService(
      prisma as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await expect(
      service.confirmFundTrade("1", { txSignature: "sig" }, "user-1"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("filters admin trade lists by status and search", async () => {
    const prisma = makePrisma();
    const service = new TradesService(
      prisma as never,
      makeAudit() as never,
      makeRedis() as never,
    );
    await service.listAllTrades("admin-1", {
      status: "SETTLED",
      search: "wallet",
    });
    expect(prisma.tradeDeal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { dealId: { contains: "wallet" } },
            { buyerWallet: { contains: "wallet" } },
            { sellerWallet: { contains: "wallet" } },
          ],
          status: "SETTLED",
        },
      }),
    );
  });
});
