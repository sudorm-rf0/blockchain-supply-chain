import {
  BadRequestException,
  ConflictException,
  HttpException,
  UnauthorizedException,
} from "@nestjs/common";
import { Keypair } from "@solana/web3.js";
import { AuthService } from "./auth.service";

function makePrisma() {
  const byEmail = new Map<string, Record<string, unknown>>();
  const byWallet = new Map<string, Record<string, unknown>>();
  return {
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
    const service = new AuthService(makePrisma() as never, makeRedis() as never);
    await expect(
      service.register({ name: "A", email: "a@example.com", password: "123" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects invalid Solana wallets", async () => {
    const service = new AuthService(makePrisma() as never, makeRedis() as never);
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
    const service = new AuthService(prisma as never, makeRedis() as never);
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
    const service = new AuthService(makePrisma() as never, redis as never);
    await expect(
      service.login(
        { email: "ip-lock@example.com", password: "wrong-pass" },
        "203.0.113.7",
      ),
    ).rejects.toThrow(HttpException);
  });

  it("logs in with a matching password and rejects a wrong one", async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma as never, makeRedis() as never);
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
    expect(ok.token).toMatch(/^eyJ/);
    await expect(
      service.login({ email: "login@example.com", password: "wrong-pass" }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
