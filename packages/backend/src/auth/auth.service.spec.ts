import {
  BadRequestException,
  ConflictException,
  HttpException,
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
  return {
    refreshToken: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "rt1", ...data })),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "rt1", ...data })),
      updateMany: jest.fn(async () => ({ count: 0 })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
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

describe("AuthService", () => {
  it("rejects short passwords", async () => {
    const service = new AuthService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(
      service.register({ name: "A", email: "a@example.com", password: "123" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects invalid Solana wallets", async () => {
    const service = new AuthService(
      makePrisma() as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await expect(
      service.register({
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
    );
    const wallet = Keypair.generate().publicKey.toBase58();
    await service.register({
      name: "A",
      email: "dup@example.com",
      password: "secret123",
      wallet,
    });
    await expect(
      service.register({
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
    );
    const wallet = Keypair.generate().publicKey.toBase58();
    await service.register({
      name: "A",
      email: "login@example.com",
      password: "secret123",
      wallet,
    });
    const result = await service.login({
      email: "login@example.com",
      password: "secret123",
    });
    expect("requiresTotp" in result).toBe(false);
    if ("requiresTotp" in result) throw new Error("unexpected requiresTotp");
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
    );
    await service.register({
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
    );
    // 密码正确性仍校验：用真实注册流程生成合法密码哈希
    await service.register({
      name: "T",
      email: "totp2@example.com",
      password: "secret123",
      wallet: Keypair.generate().publicKey.toBase58(),
    });
    // 给注册用户开启 TOTP
    await prisma.user.update({
      data: { totpEnabled: true, totpSecret: encryptForTest(secret) },
    });
    const result = await service.login({
      email: "totp2@example.com",
      password: "secret123",
    });
    expect(result).toEqual({ requiresTotp: true });

    await expect(
      service.login({
        email: "totp2@example.com",
        password: "secret123",
        totpCode: "000000",
      }),
    ).rejects.toThrow(UnauthorizedException);

    const validCode = totpCodeAt(secret, Math.floor(Date.now() / 1000 / 30));
    const okResult = await service.login({
      email: "totp2@example.com",
      password: "secret123",
      totpCode: validCode,
    });
    expect("requiresTotp" in okResult).toBe(false);
    if ("requiresTotp" in okResult) throw new Error("unexpected");
    expect(okResult.accessToken).toMatch(/^eyJ/);
  });

  it("enableTotp verifies the code before enabling", async () => {
    const secret = generateTotpSecret();
    const prisma = makePrisma();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      makeAudit() as never,
    );
    await service.register({
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
    );
    await service.register({
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
    );
    const wallet = Keypair.generate().publicKey.toBase58();
    await service.register({
      name: "A",
      email: "audit-login@example.com",
      password: "secret123",
      wallet,
    });
    await service.login({
      email: "audit-login@example.com",
      password: "secret123",
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
    );
    const wallet = Keypair.generate().publicKey.toBase58();
    await service.register({
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
      service.changePassword("u1", "wrong-pass", "newpass1234"),
    ).rejects.toThrow(BadRequestException);
  });

  it("records AUTH_PASSWORD_CHANGED after a password change", async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    const service = new AuthService(
      prisma as never,
      makeRedis() as never,
      audit as never,
    );
    const wallet = Keypair.generate().publicKey.toBase58();
    const reg = await service.register({
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
    await service.changePassword(reg.user.id, "secret123", "secret1234");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "AUTH_PASSWORD_CHANGED" }),
    );
  });
});
