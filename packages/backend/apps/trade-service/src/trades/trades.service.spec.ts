import {
  BadRequestException,
  ForbiddenException,
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

function makeAudit() {
  return { record: jest.fn(async () => undefined) };
}

describe("TradesService", () => {
  it("rejects non-matching buyer wallets on create", async () => {
    const prisma = makePrisma();
    const service = new TradesService(prisma as never, makeAudit() as never);
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
    const service = new TradesService(prisma as never, makeAudit() as never);
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
    const service = new TradesService(prisma as never, makeAudit() as never);
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
    const service = new TradesService(prisma as never, makeAudit() as never);
    await expect(service.listAllTrades("user-1")).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.listAllTrades("admin-1")).resolves.toEqual([]);
  });
});
