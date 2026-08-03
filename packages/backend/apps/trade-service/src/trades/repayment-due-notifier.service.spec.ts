import { RepaymentDueNotifierService } from "./repayment-due-notifier.service";

function makePrisma(deals: Array<Record<string, unknown>> = []) {
  return {
    tradeDeal: {
      findMany: jest.fn(async () => deals),
    },
  };
}

function makeRedis(claimed: boolean) {
  return {
    setNX: jest.fn(async () => claimed),
  };
}

function makeAudit() {
  return { record: jest.fn(async () => undefined) };
}

describe("RepaymentDueNotifierService", () => {
  it("notifies only overdue REPAYING deals", async () => {
    const now = Date.now();
    const audit = makeAudit();
    const service = new RepaymentDueNotifierService(
      makePrisma([
        {
          dealId: "1",
          buyerWallet: "buyer-1",
          sellerWallet: "seller-1",
          amount: 1_000_000n,
          createdAt: new Date(now - 200_000_000),
          tenor: 86_400n,
        },
        {
          dealId: "2",
          buyerWallet: "buyer-2",
          sellerWallet: "seller-2",
          amount: 2_000_000n,
          createdAt: new Date(now - 60_000),
          tenor: 86_400n,
        },
      ]) as never,
      audit as never,
      makeRedis(true) as never,
    );

    await service.notifyRepaymentDue();

    expect(audit.record).toHaveBeenCalledTimes(1);
    const call = (audit.record as jest.Mock).mock.calls[0][0];
    expect(call.targetId).toBe("1");
    expect(call.action).toBe("TRADE_REPAYMENT_DUE");
  });

  it("does not duplicate notifications for the same deal", async () => {
    const now = Date.now();
    const audit = makeAudit();
    const service = new RepaymentDueNotifierService(
      makePrisma([
        {
          dealId: "1",
          buyerWallet: "buyer-1",
          sellerWallet: "seller-1",
          amount: 1_000_000n,
          createdAt: new Date(now - 200_000_000),
          tenor: 86_400n,
        },
      ]) as never,
      audit as never,
      makeRedis(false) as never,
    );

    await service.notifyRepaymentDue();

    expect(audit.record).not.toHaveBeenCalled();
  });
});
