import { SyncProcessorService } from "./sync-processor.service";
import type { DealSyncPayload } from "./payloads";

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    tradeDeal: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async ({ create }) => ({
        ...create,
        id: "deal-pda",
        status: create.status,
      })),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    user: {
      upsert: jest.fn(async ({ where }) => ({
        id: where.wallet === "buyer-wallet" ? "buyer-id" : "seller-id",
      })),
    },
    ...overrides,
  };
}

function makeRisk() {
  return { notifyDefaulted: jest.fn(async () => undefined) };
}

function payload(tradeId: string, status: number): DealSyncPayload {
  return {
    accountKey: "deal-pda",
    tradeId,
    buyerWallet: "buyer-wallet",
    sellerWallet: "seller-wallet",
    amount: "1000000",
    downPayment: "300000",
    poolPortion: "700000",
    tenor: "2592000",
    status,
    createdAt: "1700000000",
    repaidAt: "0",
    txSignature: null,
    logisticsHash: null,
  };
}

describe("SyncProcessorService", () => {
  it("syncs a full-range u64 trade id without skipping it", async () => {
    const prisma = makePrisma();
    const risk = makeRisk();
    const service = new SyncProcessorService(
      prisma as never,
      risk as never,
    );
    await (service as unknown as {
      handleDealSync: (p: DealSyncPayload) => Promise<void>;
    }).handleDealSync(payload("18446744073709551615", 0));

    expect(prisma.tradeDeal.upsert).toHaveBeenCalledTimes(1);
    const call = (prisma.tradeDeal.upsert as jest.Mock).mock.calls[0][0];
    expect(call.create.dealId).toBe("18446744073709551615");
    expect(risk.notifyDefaulted).not.toHaveBeenCalled();
  });

  it("sends the defaulted webhook exactly once", async () => {
    const prisma = makePrisma({
      tradeDeal: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async ({ create }) => ({
          ...create,
          id: "deal-pda",
          status: create.status,
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    });
    const risk = makeRisk();
    const service = new SyncProcessorService(
      prisma as never,
      risk as never,
    );
    await (service as unknown as {
      handleDealSync: (p: DealSyncPayload) => Promise<void>;
    }).handleDealSync(payload("9", 7));

    expect(risk.notifyDefaulted).toHaveBeenCalledTimes(1);
    const marked = (prisma.tradeDeal.updateMany as jest.Mock).mock.calls[0][0];
    expect(marked.where.dealId).toBe("9");
  });

  it("skips a status downgrade to keep the lifecycle monotonic", async () => {
    const prisma = makePrisma({
      tradeDeal: {
        findUnique: jest.fn(async () => ({
          status: "SETTLED",
          defaultWebhookSentAt: null,
        })),
        upsert: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    });
    const risk = makeRisk();
    const service = new SyncProcessorService(
      prisma as never,
      risk as never,
    );
    await (service as unknown as {
      handleDealSync: (p: DealSyncPayload) => Promise<void>;
    }).handleDealSync(payload("9", 0));

    expect(prisma.tradeDeal.upsert).not.toHaveBeenCalled();
    expect(risk.notifyDefaulted).not.toHaveBeenCalled();
  });
});
