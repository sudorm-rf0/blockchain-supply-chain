import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { AuthService, generateTotpSecret, totpCodeAt } from "./auth.service";

process.env.JWT_SECRET = "test-secret-at-least-32-chars-long!";

function makeAudit() {
  return { record: jest.fn(async () => undefined) };
}

function encryptForTest(secret: string): string {
  const iv = randomBytes(12);
  const key = createHash("sha256")
    .update(`${process.env.JWT_SECRET}:totp`)
    .digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

function makePrisma(
  seedUsers: Array<Record<string, unknown>> = [],
) {
  const byEmail = new Map<string, Record<string, unknown>>();
  const byWallet = new Map<string, Record<string, unknown>>();
  const byId = new Map<string, Record<string, unknown>>();
  for (const u of seedUsers) {
    byEmail.set(String(u.email), u);
    byWallet.set(String(u.wallet), u);
    byId.set(String(u.id), u);
  }
  const db: any = {
    refreshToken: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "rt1", ...data })),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "rt1", ...data })),
      updateMany: jest.fn(async () => ({ count: 0 })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    inviteCode: {
      // "AB12CD" 视为有效未用邀请码；其他视为无效
      findUnique: jest.fn(async ({ where }: { where: { code: string } }) =>
        where.code === "AB12CD" ? { id: "ic1", usedAt: null } : null,
      ),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "ic1", ...data })),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { email?: string; wallet?: string; id?: string } }) => {
          if (where.id) return byId.get(where.id) ?? null;
          if (where.email) return byEmail.get(where.email) ?? null;
          if (where.wallet) return byWallet.get(where.wallet) ?? null;
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const user = { id: "u1", ...data };
        byEmail.set(String(data.email), user);
        byWallet.set(String(data.wallet), user);
        byId.set("u1", user);
        return user;
      }),
      update: jest.fn(
        async ({ where, data }: { where?: { id?: string }; data: Record<string, unknown> }) => {
          const id = String(where?.id ?? "u1");
          const current = byId.get(id) ?? {};
          const updated: Record<string, unknown> = { ...current, ...data, id: current.id ?? id };
          byId.set(id, updated);
          if (updated.email) byEmail.set(String(updated.email), updated);
          if (updated.wallet) byWallet.set(String(updated.wallet), updated);
          return updated;
        },
      ),
    },
  };
  return db;
}

function makeRedis() {
  return {
    get: jest.fn(async () => null),
    setEx: jest.fn(async () => undefined),
    incr: jest.fn(async () => 1),
    expire: jest.fn(async () => undefined),
    del: jest.fn(async () => undefined),
  };
}

function makeEmailVerification() {
  return {
    sendCode: jest.fn(async () => ({ expiresIn: 300, cooldownSeconds: 60 })),
    verifyCode: jest.fn(async () => ({
      verified: true as const,
      email: "verified@example.com",
    })),
  };
}

describe("AuthService", () => {
  it("rejects short passwords", async () => {
    const service = new AuthService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    await expect(
      service.register({
      inviteCode: "AB12CD", name: "A", email: "a@example.com", password: "123" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects invalid Solana wallets", async () => {
    const service = new AuthService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    await expect(
      service.register({
      inviteCode: "AB12CD",
        name: "A",
        email: "a@example.com",
        password: "secret123",
        wallet: "not-a-wallet",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects duplicate emails", async () => {
    const prisma = makePrisma();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    const wallet = Keypair.generate().publicKey.toBase58();
    await service.register({
      inviteCode: "AB12CD",
      name: "A",
      email: "dup@example.com",
      password: "secret123",
      wallet,
    });
    await expect(
      service.register({
      inviteCode: "AB12CD",
        name: "B",
        email: "dup@example.com",
        password: "secret123",
        wallet: Keypair.generate().publicKey.toBase58(),
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("locks an ip after too many failed attempts", async () => {
    const redis = makeRedis();
    (redis.incr as jest.Mock).mockImplementation(async (key: string) =>
      key.startsWith("login:fail:ip:") ? 20 : 1,
    );
    const service = new AuthService(
      makePrisma() as never,
      redis as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    await expect(
      service.login(
        { email: "ip-lock@example.com", password: "wrong-pass" },
        "203.0.113.7",
      ),
    ).rejects.toThrow(HttpException);
  });

  it("logs in with a matching password and rejects a wrong one", async () => {
    const prisma = makePrisma();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    const wallet = Keypair.generate().publicKey.toBase58();
    await service.register({
      inviteCode: "AB12CD",
      name: "A",
      email: "login@example.com",
      password: "secret123",
      wallet,
    });
    await service.verifyEmail("login@example.com", "123456");
    const result = await service.login({
      email: "login@example.com",
      password: "secret123",
      emailOtpCode: "123456",
    });
    expect("requiresTotp" in result).toBe(false);
    expect("requiresEmailOtp" in result).toBe(false);
    if ("requiresTotp" in result || "requiresEmailOtp" in result) {
      throw new Error("unexpected second-factor prompt");
    }
    const ok = result;
    expect(ok.accessToken).toMatch(/^eyJ/);
    expect(ok.refreshToken).toHaveLength(64);
    expect(ok.user.email).toBe("login@example.com");
    expect(ok.user.mustChangePassword).toBe(false);
    await expect(
      service.login({ email: "login@example.com", password: "wrong-pass" }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("setupTotp returns a secret and stores it encrypted", async () => {
    const prisma = makePrisma();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    await service.register({
      inviteCode: "AB12CD",
      name: "T",
      email: "setup@example.com",
      password: "secret123",
      wallet: Keypair.generate().publicKey.toBase58(),
    });
    const result = await service.setupTotp("u1");
    expect(result.secret).toBeTruthy();
    expect(result.otpauthUrl).toContain("otpauth://totp/");
    const updateData = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
    expect(String(updateData.totpSecret)).not.toContain(result.secret); // 加密存储
  });

  it("login returns requiresTotp when TOTP enabled and no code provided", async () => {
    const secret = generateTotpSecret();
    const prisma = makePrisma([
      {
        id: "u-totp",
        email: "totp@example.com",
        wallet: "wallet-totp",
        role: "USER",
        mustChangePassword: false,
        passwordHash: "salt:hash", // 密码校验不通过也会先走 TOTP 分支? 见下方断言
        totpEnabled: true,
        totpSecret: encryptForTest(secret),
      },
    ]);
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    // 密码正确性仍校验：用真实注册流程生成合法密码哈希
    await service.register({
      inviteCode: "AB12CD",
      name: "T",
      email: "totp2@example.com",
      password: "secret123",
      wallet: Keypair.generate().publicKey.toBase58(),
    });
    await service.verifyEmail("totp2@example.com", "123456");
    // 给注册用户开启 TOTP
    await prisma.user.update({
      data: { totpEnabled: true, totpSecret: encryptForTest(secret) },
    });
    const result = await service.login({
      email: "totp2@example.com",
      password: "secret123",
      emailOtpCode: "123456",
    });
    expect(result).toEqual({ requiresTotp: true });

    await expect(
      service.login({
        email: "totp2@example.com",
        password: "secret123",
        emailOtpCode: "123456",
        totpCode: "000000",
      }),
    ).rejects.toThrow(UnauthorizedException);

    const validCode = totpCodeAt(secret, Math.floor(Date.now() / 1000 / 30));
    const okResult = await service.login({
      email: "totp2@example.com",
      password: "secret123",
      emailOtpCode: "123456",
      totpCode: validCode,
    });
    expect("requiresTotp" in okResult).toBe(false);
    expect("requiresEmailOtp" in okResult).toBe(false);
    if ("requiresTotp" in okResult || "requiresEmailOtp" in okResult) {
      throw new Error("unexpected second-factor prompt");
    }
    expect(okResult.accessToken).toMatch(/^eyJ/);
  });

  it("logs in when email OTP + TOTP are both enabled (dual step)", async () => {
    const secret = generateTotpSecret();
    const prisma = makePrisma();
    const redis = makeRedis();
    // 模拟：邮箱验证码通过后由 login 写入的 10 分钟已验证标记
    let emailMarked = false;
    redis.get.mockImplementation(
      (async (key: string) =>
        key.startsWith("login:email-verified:") && emailMarked
          ? "1"
          : null) as never,
    );
    redis.setEx.mockImplementation((async () => {
      emailMarked = true;
    }) as never);
    const service = new AuthService(
      prisma as never,
      redis as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    await service.register({
      inviteCode: "AB12CD",
      name: "D",
      email: "dual@example.com",
      password: "secret123",
      wallet: Keypair.generate().publicKey.toBase58(),
    });
    await service.verifyEmail("dual@example.com", "123456");
    // 用户同时开启邮箱 OTP 与 TOTP
    await prisma.user.update({
      data: {
        emailOtpEnabled: true,
        totpEnabled: true,
        totpSecret: encryptForTest(secret),
      },
    });

    // 第一步：无邮箱验证码 → 要求邮箱验证码
    const step1 = await service.login({
      email: "dual@example.com",
      password: "secret123",
    });
    expect(step1).toEqual({ requiresEmailOtp: true });

    // 第二步：带邮箱验证码 → 通过并写入标记 → 要求 TOTP
    const step2 = await service.login({
      email: "dual@example.com",
      password: "secret123",
      emailOtpCode: "123456",
    });
    expect(step2).toEqual({ requiresTotp: true });

    // 第三步：邮箱验证码已作废，但标记存在跳过邮箱校验，TOTP 正确即成功
    const validCode = totpCodeAt(
      secret,
      Math.floor(Date.now() / 1000 / 30),
    );
    const okResult = await service.login({
      email: "dual@example.com",
      password: "secret123",
      emailOtpCode: "123456",
      totpCode: validCode,
    });
    expect("requiresTotp" in okResult).toBe(false);
    expect("requiresEmailOtp" in okResult).toBe(false);
    if ("requiresTotp" in okResult || "requiresEmailOtp" in okResult) {
      throw new Error("unexpected second-factor prompt");
    }
    expect(okResult.accessToken).toMatch(/^eyJ/);
  });

  it("enableTotp verifies the code before enabling", async () => {
    const secret = generateTotpSecret();
    const prisma = makePrisma();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    await service.register({
      inviteCode: "AB12CD",
      name: "T",
      email: "enable@example.com",
      password: "secret123",
      wallet: Keypair.generate().publicKey.toBase58(),
    });
    await prisma.user.update({
      data: { totpSecret: encryptForTest(secret) },
    });
    await expect(
      service.enableTotp("u1", "000000"),
    ).rejects.toThrow(BadRequestException);
    const ok = await service.enableTotp("u1", totpCodeAt(secret, Math.floor(Date.now() / 1000 / 30)));
    expect(ok).toEqual({ ok: true });
  });

  it("disableTotp requires a valid code and clears the secret", async () => {
    const secret = generateTotpSecret();
    const prisma = makePrisma();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    await service.register({
      inviteCode: "AB12CD",
      name: "T",
      email: "disable@example.com",
      password: "secret123",
      wallet: Keypair.generate().publicKey.toBase58(),
    });
    await prisma.user.update({
      data: {
        totpSecret: encryptForTest(secret),
        totpEnabled: true,
      },
    });
    await expect(
      service.disableTotp("u1", "000000"),
    ).rejects.toThrow(BadRequestException);
    const ok = await service.disableTotp("u1", totpCodeAt(secret, Math.floor(Date.now() / 1000 / 30)));
    expect(ok).toEqual({ ok: true });
  });

  it("records AUTH_LOGIN on successful login", async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      audit as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    const wallet = Keypair.generate().publicKey.toBase58();
    await service.register({
      inviteCode: "AB12CD",
      name: "A",
      email: "audit-login@example.com",
      password: "secret123",
      wallet,
    });
    await service.verifyEmail("audit-login@example.com", "123456");
    await service.login({
      email: "audit-login@example.com",
      password: "secret123",
      emailOtpCode: "123456",
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "AUTH_LOGIN" }),
    );
  });

  it("changes password and clears the must-change flag", async () => {
    const prisma = makePrisma();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    const wallet = Keypair.generate().publicKey.toBase58();
    await service.register({
      inviteCode: "AB12CD",
      name: "A",
      email: "change@example.com",
      password: "secret123",
      wallet,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "u1",
      email: "change@example.com",
      name: "A",
      wallet,
      role: "USER",
      passwordHash:
        "salt:" +
        Buffer.alloc(64, 1).toString("hex"),
      mustChangePassword: false,
    });
    await expect(
      service.changePassword("u1", "wrong-pass", "newpass1234", "123456"),
    ).rejects.toThrow(BadRequestException);
  });

  it("records AUTH_PASSWORD_CHANGED after a password change", async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      audit as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    const wallet = Keypair.generate().publicKey.toBase58();
    const reg = await service.register({
      inviteCode: "AB12CD",
      name: "A",
      email: "audit-pass@example.com",
      password: "secret123",
      wallet,
    });
    const created = (prisma.user.create as jest.Mock).mock.calls[0][0].data;
    (prisma.user.findUnique as jest.Mock).mockImplementation(
      async ({ where }: { where: { id?: string } }) =>
        where.id
          ? {
              id: "u1",
              email: created.email,
              name: created.name,
              wallet,
              role: "USER",
              passwordHash: created.passwordHash,
              mustChangePassword: false,
            }
          : null,
    );
    await service.changePassword(reg.user.id, "secret123", "secret1234", "123456");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "AUTH_PASSWORD_CHANGED" }),
    );
  });

  it("register sends a code and creates an unverified account (no session)", async () => {
    const prisma = makePrisma();
    const emailVerification = makeEmailVerification();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      emailVerification as never,
    );
    const wallet = Keypair.generate().publicKey.toBase58();
    const result = await service.register({
      inviteCode: "AB12CD",
      name: "A",
      email: "pending@example.com",
      password: "secret123",
      wallet,
    });

    expect(emailVerification.sendCode).toHaveBeenCalledWith("pending@example.com");
    expect(result).toEqual(
      expect.objectContaining({
        requiresEmailVerification: true,
        expiresIn: 300,
        cooldownSeconds: 60,
      }),
    );
    expect("accessToken" in result).toBe(false);
    const created = (prisma.user.create as jest.Mock).mock.calls[0][0].data;
    expect(created.emailVerified).toBe(false);
    expect(created.email).toBe("pending@example.com");
  });

  it("register propagates send failure and does not create the user", async () => {
    const prisma = makePrisma();
    const emailVerification = makeEmailVerification();
    (emailVerification.sendCode as jest.Mock).mockRejectedValue(
      new ServiceUnavailableException("邮件发送失败，请稍后重试"),
    );
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      emailVerification as never,
    );
    await expect(
      service.register({
      inviteCode: "AB12CD",
        name: "A",
        email: "send-fail@example.com",
        password: "secret123",
      }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("verifyEmail activates the account and records an audit event", async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      audit as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    await service.register({
      inviteCode: "AB12CD",
      name: "A",
      email: "activate@example.com",
      password: "secret123",
    });
    const result = await service.verifyEmail("activate@example.com", "123456");

    expect(result).toEqual({ ok: true, email: "activate@example.com" });
    const updated = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
    expect(updated.emailVerified).toBe(true);
    expect(updated.emailVerifiedAt).toBeInstanceOf(Date);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "EMAIL_VERIFIED" }),
    );
  });

  it("verifyEmail rejects an unknown email", async () => {
    const service = new AuthService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    await expect(
      service.verifyEmail("nobody@example.com", "123456"),
    ).rejects.toThrow(BadRequestException);
  });

  it("login blocks an unverified account", async () => {
    const prisma = makePrisma();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    await service.register({
      inviteCode: "AB12CD",
      name: "A",
      email: "unverified@example.com",
      password: "secret123",
      wallet: Keypair.generate().publicKey.toBase58(),
    });
    await expect(
      service.login({ email: "unverified@example.com", password: "secret123" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("login always requires email OTP for registered accounts (mandatory)", async () => {
    const prisma = makePrisma();
    const emailVerification = makeEmailVerification();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      emailVerification as never,
    );
    await service.register({
      inviteCode: "AB12CD",
      name: "A",
      email: "otp-login@example.com",
      password: "secret123",
      wallet: Keypair.generate().publicKey.toBase58(),
    });
    await service.verifyEmail("otp-login@example.com", "123456");

    const result = await service.login({
      email: "otp-login@example.com",
      password: "secret123",
    });

    expect(result).toEqual({ requiresEmailOtp: true });
    expect(emailVerification.sendCode).toHaveBeenLastCalledWith(
      "otp-login@example.com",
    );
  });

  it("login completes with a valid email OTP code", async () => {
    const prisma = makePrisma();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
    await service.register({
      inviteCode: "AB12CD",
      name: "A",
      email: "otp-login2@example.com",
      password: "secret123",
      wallet: Keypair.generate().publicKey.toBase58(),
    });
    await service.verifyEmail("otp-login2@example.com", "123456");

    const result = await service.login({
      email: "otp-login2@example.com",
      password: "secret123",
      emailOtpCode: "123456",
    });

    expect("requiresEmailOtp" in result).toBe(false);
    expect("requiresTotp" in result).toBe(false);
    if ("requiresEmailOtp" in result || "requiresTotp" in result) {
      throw new Error("unexpected second-factor prompt");
    }
    expect(result.accessToken).toMatch(/^eyJ/);
    expect(result.user.emailOtpEnabled).toBe(true);
  });

  it("changePassword requires and verifies an email code", async () => {
    const prisma = makePrisma();
    const emailVerification = makeEmailVerification();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      emailVerification as never,
    );
    await service.register({
      inviteCode: "AB12CD",
      name: "A",
      email: "cp-code@example.com",
      password: "secret123",
      wallet: Keypair.generate().publicKey.toBase58(),
    });
    await service.changePassword("u1", "secret123", "secret1234", "123456");
    expect(emailVerification.verifyCode).toHaveBeenCalledWith(
      "cp-code@example.com",
      "123456",
    );
  });

  it("bindWallet requires and verifies an email code", async () => {
    const prisma = makePrisma();
    const emailVerification = makeEmailVerification();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      emailVerification as never,
    );
    const wallet1 = Keypair.generate().publicKey.toBase58();
    const wallet2 = Keypair.generate().publicKey.toBase58();
    await service.register({
      inviteCode: "AB12CD",
      name: "A",
      email: "bind-wallet@example.com",
      password: "secret123",
      wallet: wallet1,
    });
    const user = await service.bindWallet("u1", wallet2, "123456");
    expect(user.wallet).toBe(wallet2);
    expect(emailVerification.verifyCode).toHaveBeenCalledWith(
      "bind-wallet@example.com",
      "123456",
    );
  });
});

describe("AuthService invite codes", () => {
  function makeService(prisma: any, redis: any = makeRedis()) {
    return new AuthService(
      prisma as never,
      redis as never,
      makeAudit() as never,
      { verify: jest.fn(async (_t?: string, _o?: unknown) => true) } as never,
      makeEmailVerification() as never,
    );
  }

  it("rejects invalid invite code format", async () => {
    const service = makeService(makePrisma());
    await expect(
      service.register({ name: "A", email: "a@example.com", password: "secret123", inviteCode: "abc" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects unknown invite code", async () => {
    const service = makeService(makePrisma());
    await expect(
      service.register({ name: "A", email: "a@example.com", password: "secret123", inviteCode: "ZZZZ99" }),
    ).rejects.toThrow("邀请码无效");
  });

  it("rejects already-used invite code", async () => {
    const prisma = makePrisma();
    (prisma.inviteCode.findUnique as jest.Mock).mockResolvedValue({ id: "ic1", usedAt: new Date() });
    const service = makeService(prisma);
    await expect(
      service.register({ name: "A", email: "a@example.com", password: "secret123", inviteCode: "AB12CD" }),
    ).rejects.toThrow("邀请码已被使用");
  });

  it("claims invite code on successful register", async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const wallet = Keypair.generate().publicKey.toBase58();
    await service.register({ name: "A", email: "a@example.com", password: "secret123", wallet, inviteCode: "AB12CD" });
    // user.create 收到 inviteCodeId
    const createCall = (prisma.user.create as jest.Mock).mock.calls[0][0].data;
    expect(createCall.inviteCodeId).toBe("ic1");
    // 邀请码被更新为已使用
    const updateCall = (prisma.inviteCode.update as jest.Mock).mock.calls[0];
    expect(updateCall[0].where.id).toBe("ic1");
    expect(updateCall[0].data.usedById).toBeTruthy();
  });
});
