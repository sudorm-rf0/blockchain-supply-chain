import { RiskControlWebhookService } from "./risk-control-webhook.service";

const TEST_SECRET = "test-webhook-secret-0123456789abcdef";

const deal = {
  id: "deal-pda",
  dealId: "123456789",
  buyerWallet: "buyer",
  sellerWallet: "seller",
  amount: 1_000_000n,
  downPayment: 300_000n,
  poolPortion: 700_000n,
  tenor: 2_592_000n,
  status: "DEFAULTED",
  txSignature: "sig",
};

describe("RiskControlWebhookService", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.WEBHOOK_RETRY_DELAY_MS = "1";
    process.env.WEBHOOK_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_RETRY_DELAY_MS;
    delete process.env.WEBHOOK_SECRET;
  });

  it("delivers a signed defaulted webhook with nonce", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const service = new RiskControlWebhookService();
    await service.notifyDefaulted(deal as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      {
        headers: Record<string, string>;
        body: string;
      },
    ];
    expect(url).toContain("/risk/defaulted");
    expect(init.headers["x-webhook-signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(init.headers["x-webhook-timestamp"]).toMatch(/^\d+$/);
    expect(init.headers["x-webhook-nonce"]).toMatch(/^[0-9a-f]{32}$/);
    const body = JSON.parse(init.body) as {
      event: string;
      deal: { dealId: string };
    };
    expect(body.event).toBe("deal.defaulted");
    expect(body.deal.dealId).toBe("123456789");
  });

  it("fails closed when WEBHOOK_SECRET is missing", async () => {
    delete process.env.WEBHOOK_SECRET;
    const service = new RiskControlWebhookService();
    await expect(service.notifyDefaulted(deal as never)).rejects.toThrow(
      "WEBHOOK_SECRET must be set",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails loudly when the risk service rejects the webhook", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const service = new RiskControlWebhookService();
    await expect(service.notifyDefaulted(deal as never)).rejects.toThrow(
      "risk webhook responded 500",
    );
  });

  it("propagates network failures when the risk service is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const service = new RiskControlWebhookService();
    await expect(service.notifyDefaulted(deal as never)).rejects.toThrow(
      "network down",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries transient failures and succeeds on a later attempt", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockRejectedValueOnce(new Error("still down"))
      .mockResolvedValue({ ok: true, status: 200 });
    const service = new RiskControlWebhookService();
    await expect(service.notifyDefaulted(deal as never)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
