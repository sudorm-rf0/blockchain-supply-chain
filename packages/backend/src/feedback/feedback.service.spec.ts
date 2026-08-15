import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { Resend } from "resend";
import { RedisService } from "@supply-chain/common";
import { AuditService } from "../audit/audit.service";
import { FeedbackService } from "./feedback.service";

jest.mock("resend", () => ({ Resend: jest.fn() }));

const ResendMock = Resend as unknown as jest.Mock;

function makeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    setEx: jest.fn(async (key: string, _seconds: number, value: string) => {
      store.set(key, value);
    }),
    incr: jest.fn(async (key: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: jest.fn(async () => undefined),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

function makeService(env: Record<string, string> = {}) {
  process.env.RESEND_API_KEY = env.RESEND_API_KEY ?? "re_test_1234567890";
  process.env.RESEND_FROM =
    env.RESEND_FROM ?? "SupplyChain <noreply@example.com>";
  process.env.FEEDBACK_TO_EMAIL = env.FEEDBACK_TO_EMAIL ?? "ops@example.com";
  const send = jest.fn(async () => ({ data: { id: "m1" }, error: null }));
  ResendMock.mockImplementation(() => ({ emails: { send } }));
  const redis = makeRedis();
  const audit = { record: jest.fn(async () => undefined) };
  const service = new FeedbackService(
    redis as unknown as RedisService,
    audit as unknown as AuditService,
  );
  return { service, redis, audit, send };
}

describe("FeedbackService", () => {
  it("rejects empty feedback content", async () => {
    const { service } = makeService();
    await expect(
      service.submit("user-1", "u@example.com", { content: "   " }),
    ).rejects.toThrow(BadRequestException);
  });

  it("sends feedback email to the configured recipient", async () => {
    const { service, send, audit } = makeService();
    const result = await service.submit("user-1", "u@example.com", {
      content: "建议增加 AI 审核",
      contact: "wechat:foo",
    });
    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "SupplyChain <noreply@example.com>",
        to: ["ops@example.com"],
        subject: expect.stringContaining("[用户反馈]"),
        text: expect.stringContaining("建议增加 AI 审核"),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "FEEDBACK_SUBMITTED" }),
    );
  });

  it("rate-limits repeated submissions within 60s", async () => {
    const { service, redis } = makeService();
    redis.store.set("feedback:cooldown:user-1", String(Math.floor(Date.now() / 1000) + 30));
    await expect(
      service.submit("user-1", "u@example.com", { content: "再来一条" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("fails closed in production when email is not configured", async () => {
    const { service } = makeService({ RESEND_API_KEY: "", FEEDBACK_TO_EMAIL: "" });
    await expect(
      service.submit("user-1", null, { content: "hello" }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
