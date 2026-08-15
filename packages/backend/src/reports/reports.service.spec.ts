import { ReportsService } from "./reports.service";

function makePrisma() {
  return {
    tradeDeal: { findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
    financingRequest: { findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
    auditLog: { findMany: jest.fn(), count: jest.fn() },
  } as never;
}

describe("ReportsService", () => {
  it("summarizes orders with formatted USDC amounts", async () => {
    const prisma = makePrisma() as {
      tradeDeal: { findMany: jest.Mock; count: jest.Mock; aggregate: jest.Mock };
    };
    prisma.tradeDeal.findMany.mockResolvedValue([
      { id: "t1", dealId: "D-1", buyerWallet: "b", sellerWallet: "s", amount: 150000000n, downPayment: 50000000n, status: "ACTIVE", createdAt: new Date(), repaidAt: null },
    ]);
    prisma.tradeDeal.count.mockResolvedValue(1);
    prisma.tradeDeal.aggregate.mockResolvedValue({ _sum: { amount: 150000000n, downPayment: 50000000n }, _count: 1 });
    const svc = new ReportsService(prisma as never);
    const out = await svc.orders();
    expect(out.summary.total).toBe(1);
    expect(out.summary.amountTotal).toBe("150.00");
    expect(out.summary.byStatus).toEqual({ ACTIVE: 1 });
    expect(out.items[0].amount).toBe("150.00");
  });

  it("honors from/to/status filters", async () => {
    const prisma = makePrisma() as {
      tradeDeal: { findMany: jest.Mock; count: jest.Mock; aggregate: jest.Mock };
    };
    prisma.tradeDeal.findMany.mockResolvedValue([]);
    prisma.tradeDeal.count.mockResolvedValue(0);
    prisma.tradeDeal.aggregate.mockResolvedValue({ _sum: null, _count: 0 });
    const svc = new ReportsService(prisma as never);
    await svc.orders("2026-08-01", "2026-08-31", "ACTIVE");
    const where = prisma.tradeDeal.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("ACTIVE");
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });

  it("summarizes financing", async () => {
    const prisma = makePrisma() as {
      financingRequest: { findMany: jest.Mock; count: jest.Mock; aggregate: jest.Mock };
    };
    prisma.financingRequest.findMany.mockResolvedValue([
      { id: "f1", invoiceId: "inv1", applicantId: "u1", invoiceAmount: 200000000n, amount: 120000000n, discountRate: 5, tenorDays: 30, status: "PENDING", reviewedAt: null, createdAt: new Date() },
    ]);
    prisma.financingRequest.count.mockResolvedValue(1);
    prisma.financingRequest.aggregate.mockResolvedValue({ _sum: { amount: 120000000n, invoiceAmount: 200000000n }, _count: 1 });
    const svc = new ReportsService(prisma as never);
    const out = await svc.financing();
    expect(out.summary.amountTotal).toBe("120.00");
    expect(out.items[0].invoiceAmount).toBe("200.00");
  });

  it("summarizes audit by action", async () => {
    const prisma = makePrisma() as {
      auditLog: { findMany: jest.Mock; count: jest.Mock };
    };
    prisma.auditLog.findMany.mockResolvedValue([
      { id: "a1", actorEmail: "x@y.z", action: "FILE_APPROVED", targetType: "FILE", targetId: "f1", metadata: null, createdAt: new Date() },
    ]);
    prisma.auditLog.count.mockResolvedValue(1);
    const svc = new ReportsService(prisma as never);
    const out = await svc.audit();
    expect(out.summary.byAction).toEqual({ FILE_APPROVED: 1 });
  });

  it("exports CSV with headers", async () => {
    const prisma = makePrisma() as {
      tradeDeal: { findMany: jest.Mock; count: jest.Mock; aggregate: jest.Mock };
    };
    prisma.tradeDeal.findMany.mockResolvedValue([
      { id: "t1", dealId: "D-1", buyerWallet: "b", sellerWallet: "s", amount: 1000000n, downPayment: 300000n, status: "ACTIVE", createdAt: new Date("2026-08-01"), repaidAt: null },
    ]);
    prisma.tradeDeal.count.mockResolvedValue(1);
    prisma.tradeDeal.aggregate.mockResolvedValue({ _sum: { amount: 1000000n, downPayment: 300000n }, _count: 1 });
    const svc = new ReportsService(prisma as never);
    const csv = await svc.ordersCsv();
    expect(csv).toContain("订单号");
    expect(csv).toContain("D-1");
  });
});
