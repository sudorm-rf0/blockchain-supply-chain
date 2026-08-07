import { NotifierService } from "./notifier.service";

const TEST_SECRET = "test-webhook-secret-0123456789abcdef";

describe("NotifierService", () => {
  const OLD_ENV = process.env;

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("skips when no notify url is configured", async () => {
    delete process.env.REPAYMENT_NOTIFY_URL;
    const service = new NotifierService();
    await expect(service.send("repayment.due", { dealId: "1" })).resolves.toBeUndefined();
  });

  it("delivers to the configured endpoint with a signature and nonce", async () => {
    process.env.REPAYMENT_NOTIFY_URL = "http://localhost:9999/hook";
    process.env.WEBHOOK_SECRET = TEST_SECRET;
    const fetchMock = jest.fn(async () => ({ ok: true })) as never;
    global.fetch = fetchMock;
    const service = new NotifierService();
    await service.send("repayment.due", { dealId: "1" });
    const [url, init] = (fetchMock as jest.Mock).mock.calls[0];
    expect(url).toBe("http://localhost:9999/hook");
    expect(init.headers["x-webhook-signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(init.headers["x-webhook-timestamp"]).toMatch(/^\d+$/);
    expect(init.headers["x-webhook-nonce"]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("fails closed when a notify url is configured but WEBHOOK_SECRET is missing", async () => {
    process.env.REPAYMENT_NOTIFY_URL = "http://localhost:9999/hook";
    delete process.env.WEBHOOK_SECRET;
    global.fetch = jest.fn() as never;
    const service = new NotifierService();
    await expect(
      service.send("repayment.due", { dealId: "1" }),
    ).rejects.toThrow("WEBHOOK_SECRET must be set");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fails closed in production when WEBHOOK_SECRET is too short", async () => {
    process.env.REPAYMENT_NOTIFY_URL = "http://localhost:9999/hook";
    process.env.NODE_ENV = "production";
    process.env.WEBHOOK_SECRET = "short";
    const service = new NotifierService();
    await expect(
      service.send("repayment.due", { dealId: "1" }),
    ).rejects.toThrow("WEBHOOK_SECRET must be >= 32 chars");
  });

  it("retries and fails after repeated errors", async () => {
    process.env.REPAYMENT_NOTIFY_URL = "http://localhost:9999/hook";
    process.env.WEBHOOK_SECRET = TEST_SECRET;
    global.fetch = jest.fn(async () => {
      throw new Error("network down");
    }) as never;
    const service = new NotifierService();
    await expect(
      service.send("repayment.due", { dealId: "1" }),
    ).rejects.toThrow("network down");
  });
});
