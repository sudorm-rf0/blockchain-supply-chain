import { IntegrationsService } from "./integrations.service";

function makePrisma() {
  return {
    apiKey: { findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    webhook: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  } as never;
}

describe("IntegrationsService", () => {
  it("creates an API key and returns raw key once", async () => {
    const prisma = makePrisma() as {
      apiKey: { findMany: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
    };
    prisma.apiKey.create.mockImplementation(async ({ data }) => ({ id: "k1", ...data }));
    const svc = new IntegrationsService(prisma as never);
    const out = await svc.createApiKey("u1", { name: "CI" });
    expect(out.key).toMatch(/^sk_live_/);
    expect(out.prefix).toBe(out.key.slice(0, 12));
    // keyHash 必须是 sha256，不返回原始密钥
    expect(prisma.apiKey.create.mock.calls[0][0].data.keyHash).not.toBe(out.key);
    expect(prisma.apiKey.create.mock.calls[0][0].data.keyHash).toHaveLength(64);
  });

  it("rejects empty API key name", async () => {
    const prisma = makePrisma() as {
      apiKey: { findMany: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
    };
    const svc = new IntegrationsService(prisma as never);
    await expect(svc.createApiKey("u1", { name: "  " })).rejects.toThrow("名称不能为空");
  });

  it("revokes API key only when owned and active", async () => {
    const prisma = makePrisma() as {
      apiKey: { findMany: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
    };
    prisma.apiKey.updateMany.mockResolvedValue({ count: 1 });
    const svc = new IntegrationsService(prisma as never);
    await expect(svc.revokeApiKey("u1", "k1")).resolves.toEqual({ ok: true });
    expect(prisma.apiKey.updateMany).toHaveBeenCalledWith({
      where: { id: "k1", userId: "u1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("creates webhook with secret and validated url", async () => {
    const prisma = makePrisma() as {
      webhook: { findMany: jest.Mock; create: jest.Mock; findFirst: jest.Mock; update: jest.Mock; deleteMany: jest.Mock };
    };
    prisma.webhook.create.mockImplementation(async ({ data }) => ({ id: "w1", ...data }));
    const svc = new IntegrationsService(prisma as never);
    const out = await svc.createWebhook("u1", { name: "ERP", url: "https://erp.example/hook", events: ["FILE_REVIEWED"] });
    expect(out.secret).toMatch(/^whsec_/);
    expect(prisma.webhook.create.mock.calls[0][0].data.secretHash).toHaveLength(64);
  });

  it("rejects non-http webhook url", async () => {
    const prisma = makePrisma() as {
      webhook: { findMany: jest.Mock; create: jest.Mock; findFirst: jest.Mock; update: jest.Mock; deleteMany: jest.Mock };
    };
    const svc = new IntegrationsService(prisma as never);
    await expect(svc.createWebhook("u1", { name: "x", url: "ftp://bad", events: [] })).rejects.toThrow("http");
  });

  it("deletes webhook only when owned", async () => {
    const prisma = makePrisma() as {
      webhook: { findMany: jest.Mock; create: jest.Mock; findFirst: jest.Mock; update: jest.Mock; deleteMany: jest.Mock };
    };
    prisma.webhook.deleteMany.mockResolvedValue({ count: 1 });
    const svc = new IntegrationsService(prisma as never);
    await expect(svc.deleteWebhook("u1", "w1")).resolves.toEqual({ ok: true });
    expect(prisma.webhook.deleteMany).toHaveBeenCalledWith({ where: { id: "w1", userId: "u1" } });
  });

  it("test webhook returns non-ok on network failure", async () => {
    const prisma = makePrisma() as {
      webhook: { findMany: jest.Mock; create: jest.Mock; findFirst: jest.Mock; update: jest.Mock; deleteMany: jest.Mock };
    };
    prisma.webhook.findFirst.mockResolvedValue({ id: "w1", url: "https://invalid.example/x", events: [] });
    prisma.webhook.update.mockResolvedValue({});
    const svc = new IntegrationsService(prisma as never);
    const out = await svc.testWebhook("u1", "w1");
    expect(out.ok).toBe(false);
  });
});

describe("IntegrationsService webhook SSRF 防护", () => {
  const makeWebhookPrisma = () => ({
    apiKey: { findMany: jest.fn(async () => []), create: jest.fn(async (x: unknown) => x), updateMany: jest.fn(async () => ({ count: 0 })) },
    webhook: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "w1", ...data })),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  });

  it("拒绝内网/环回地址", async () => {
    const service = new IntegrationsService(makeWebhookPrisma() as never);
    for (const url of ["http://127.0.0.1:3001/hook", "http://192.168.1.10/hook", "http://10.0.0.5/hook", "http://169.254.169.254/latest/meta-data/"]) {
      await expect(
        service.createWebhook("u1", { name: "x", url }),
      ).rejects.toThrow("内网");
    }
  });

  it("拒绝 localhost 与 .local 域名", async () => {
    const service = new IntegrationsService(makeWebhookPrisma() as never);
    await expect(
      service.createWebhook("u1", { name: "x", url: "http://localhost:3001/hook" }),
    ).rejects.toThrow("本机");
    await expect(
      service.createWebhook("u1", { name: "x", url: "http://printer.local/hook" }),
    ).rejects.toThrow("本机");
  });

  it("允许公网 URL", async () => {
    const service = new IntegrationsService(makeWebhookPrisma() as never);
    const res = await service.createWebhook("u1", { name: "x", url: "https://example.com/hook" });
    expect(res.url).toBe("https://example.com/hook");
  });
});
