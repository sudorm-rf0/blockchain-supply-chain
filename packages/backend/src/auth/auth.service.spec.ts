import {
  BadRequestException,
  ConflictException,
  HttpException,
  UnauthorizedException,
} from "@nestjs/common";
import { Keypair } from "@solana/web3.js";
import { AuthService } from "./auth.service";

function makeAudit() {
  return { record: jest.fn(async () => undefined) };
}

function makePrisma() {
  const byEmail = new Map<string, Record<string, unknown>>();
  const byWallet = new Map<string, Record<string, unknown>>();
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
        async ({ where }: { where: { email?: string; wallet?: string } }) => {
          if (where.email) return byEmail.get(where.email) ?? null;
          if (where.wallet) return byWallet.get(where.wallet) ?? null;
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const user = { id: "u1", ...data };
        byEmail.set(String(data.email), user);
        byWallet.set(String(data.wallet), user);
        return user;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        return { id: "u1", ...data };
      }),
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
    const ok = await service.login({
      email: "login@example.com",
      password: "secret123",
    });
    expect(ok.accessToken).toMatch(/^eyJ/);
    expect(ok.refreshToken).toHaveLength(64);
    expect(ok.user.email).toBe("login@example.com");
    expect(ok.user.mustChangePassword).toBe(false);
    await expect(
      service.login({ email: "login@example.com", password: "wrong-pass" }),
    ).rejects.toThrow(UnauthorizedException);
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
});
