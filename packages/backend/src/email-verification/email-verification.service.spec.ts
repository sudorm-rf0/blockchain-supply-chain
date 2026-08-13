import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Resend } from "resend";
import { RedisService } from "@supply-chain/common";
import { AuditService } from "../audit/audit.service";
import { EmailVerificationService } from "./email-verification.service";

jest.mock("resend", () => ({ Resend: jest.fn() }));

const ResendMock = Resend as unknown as jest.Mock;

const EMAIL = "user@example.com";
const DIGEST = createHash("sha256").update(EMAIL).digest("hex");
const CODE_KEY = `email-code:code:${DIGEST}`;
const COOLDOWN_KEY = `email-code:cooldown:${DIGEST}`;

function makeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    setEx: jest.fn(async (key: string, _seconds: number, value: string) => {
      store.set(key, value);
    }),
    setNX: jest.fn(async (key: string, value: string) => {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
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
  process.env.NODE_ENV = env.NODE_ENV ?? "test";
  const send = jest.fn();
  ResendMock.mockImplementation(() => ({ emails: { send } }));
  const redis = makeRedis();
  const audit = { record: jest.fn(async () => undefined) };
  const service = new EmailVerificationService(
    redis as unknown as RedisService,
    audit as unknown as AuditService,
  );
  return { service, redis, audit, send };
}

describe("EmailVerificationService", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  describe("sendCode", () => {
    it("生成 6 位验证码、入库并通过 Resend 发送", async () => {
      const { service, redis, send, audit } = makeService();
      send.mockResolvedValue({ data: { id: "email_1" }, error: null });

      const result = await service.sendCode(EMAIL);

      expect(result).toEqual({
        expiresIn: 300,
        cooldownSeconds: 60,
      });
      const stored = JSON.parse(redis.store.get(CODE_KEY)!) as {
        code: string;
        attempts: number;
      };
      expect(stored.code).toMatch(/^\d{6}$/);
      expect(stored.attempts).toBe(0);
      expect(redis.store.has(COOLDOWN_KEY)).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
      const payload = send.mock.calls[0][0] as {
        from: string;
        to: string[];
        subject: string;
        html: string;
      };
      expect(payload.to).toEqual([EMAIL]);
      expect(payload.subject).toContain("邮箱验证码");
      expect(payload.html).toContain(stored.code);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "EMAIL_CODE_SENT" }),
      );
    });

    it("冷却期内拒绝重复发送", async () => {
      const { service, redis, send } = makeService();
      const future = Math.floor(Date.now() / 1000) + 30;
      redis.store.set(COOLDOWN_KEY, String(future));

      await expect(service.sendCode(EMAIL)).rejects.toThrow(
        BadRequestException,
      );
      expect(send).not.toHaveBeenCalled();
    });

    it("超过每小时上限拒绝发送", async () => {
      const { service, redis, send } = makeService();
      const hourBucket = Math.floor(Date.now() / 1000 / 3600);
      redis.store.set(`email-code:rl:${DIGEST}:${hourBucket}`, "5");

      await expect(service.sendCode(EMAIL)).rejects.toThrow(
        BadRequestException,
      );
      expect(send).not.toHaveBeenCalled();
    });

    it("Resend 返回 error 时抛出 503", async () => {
      const { service, send } = makeService();
      send.mockResolvedValue({
        data: null,
        error: new Error("rate limited"),
      });

      await expect(service.sendCode(EMAIL)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("Resend 抛异常时抛出 503", async () => {
      const { service, send } = makeService();
      send.mockRejectedValue(new Error("network down"));

      await expect(service.sendCode(EMAIL)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("生产环境未配置 API Key 时 fail-closed（503）", async () => {
      const { service, send } = makeService({
        RESEND_API_KEY: "",
        NODE_ENV: "production",
      });

      await expect(service.sendCode(EMAIL)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(send).not.toHaveBeenCalled();
    });

    it("开发环境未配置 API Key 时返回 devCode 且不发送", async () => {
      const { service, redis, send } = makeService({
        RESEND_API_KEY: "",
        NODE_ENV: "development",
      });

      const result = await service.sendCode(EMAIL);

      expect(result.devCode).toMatch(/^\d{6}$/);
      const stored = JSON.parse(redis.store.get(CODE_KEY)!) as {
        code: string;
      };
      expect(stored.code).toBe(result.devCode);
      expect(redis.store.has(COOLDOWN_KEY)).toBe(true);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("verifyCode", () => {
    it("验证码正确时校验通过并作废（单次使用）", async () => {
      const { service, redis, audit } = makeService();
      redis.store.set(
        CODE_KEY,
        JSON.stringify({ code: "123456", attempts: 0 }),
      );

      const result = await service.verifyCode(EMAIL, "123456");

      expect(result).toEqual({ verified: true, email: EMAIL });
      expect(redis.store.has(CODE_KEY)).toBe(false);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "EMAIL_CODE_VERIFIED" }),
      );
    });

    it("验证码错误时增加尝试次数", async () => {
      const { service, redis } = makeService();
      redis.store.set(
        CODE_KEY,
        JSON.stringify({ code: "123456", attempts: 0 }),
      );

      await expect(service.verifyCode(EMAIL, "000000")).rejects.toThrow(
        BadRequestException,
      );
      const stored = JSON.parse(redis.store.get(CODE_KEY)!) as {
        attempts: number;
      };
      expect(stored.attempts).toBe(1);
    });

    it("尝试次数达到上限后作废验证码", async () => {
      const { service, redis } = makeService();
      redis.store.set(
        CODE_KEY,
        JSON.stringify({ code: "123456", attempts: 5 }),
      );

      await expect(service.verifyCode(EMAIL, "123456")).rejects.toThrow(
        BadRequestException,
      );
      expect(redis.store.has(CODE_KEY)).toBe(false);
    });

    it("验证码不存在或已过期时拒绝", async () => {
      const { service } = makeService();

      await expect(service.verifyCode(EMAIL, "123456")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("存储内容损坏时拒绝并清理", async () => {
      const { service, redis } = makeService();
      redis.store.set(CODE_KEY, "not-json");

      await expect(service.verifyCode(EMAIL, "123456")).rejects.toThrow(
        BadRequestException,
      );
      expect(redis.store.has(CODE_KEY)).toBe(false);
    });
  });
});
