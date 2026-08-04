import { NotifierService } from "./notifier.service";

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

  it("delivers to the configured endpoint with a signature", async () => {
    process.env.REPAYMENT_NOTIFY_URL = "http://localhost:9999/hook";
    process.env.WEBHOOK_SECRET = "secret";
    const fetchMock = jest.fn(async () => ({ ok: true })) as never;
    global.fetch = fetchMock;
    const service = new NotifierService();
    await service.send("repayment.due", { dealId: "1" });
    const [url, init] = (fetchMock as jest.Mock).mock.calls[0];
    expect(url).toBe("http://localhost:9999/hook");
    expect(init.headers["x-webhook-signature"]).toBeDefined();
    expect(init.headers["x-webhook-timestamp"]).toBeDefined();
  });

  it("retries and fails after repeated errors", async () => {
    process.env.REPAYMENT_NOTIFY_URL = "http://localhost:9999/hook";
    global.fetch = jest.fn(async () => {
      throw new Error("network down");
    }) as never;
    const service = new NotifierService();
    await expect(
      service.send("repayment.due", { dealId: "1" }),
    ).rejects.toThrow("network down");
  });
});
