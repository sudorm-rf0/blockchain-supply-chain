import { AuditRetentionService } from "./audit-retention.service";

describe("AuditRetentionService", () => {
  const OLD_ENV = process.env;

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("deletes audit logs older than the configured retention window", async () => {
    process.env.AUDIT_RETENTION_DAYS = "30";
    const prisma = {
      auditLog: {
        deleteMany: jest.fn(async () => ({ count: 12 })),
      },
    };
    const service = new AuditRetentionService(prisma as never);
    await service.purgeExpired();

    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
  });

  it("skips purging when retention is disabled", async () => {
    process.env.AUDIT_RETENTION_DAYS = "0";
    const prisma = {
      auditLog: { deleteMany: jest.fn() },
    };
    const service = new AuditRetentionService(prisma as never);
    await service.purgeExpired();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it("uses the default 90-day retention when unset", async () => {
    delete process.env.AUDIT_RETENTION_DAYS;
    const prisma = {
      auditLog: {
        deleteMany: jest.fn(async ({ where }) => {
          const cutoff = where.createdAt.lt;
          expect(Date.now() - cutoff.getTime()).toBeGreaterThan(
            89 * 24 * 60 * 60 * 1000,
          );
          expect(Date.now() - cutoff.getTime()).toBeLessThan(
            91 * 24 * 60 * 60 * 1000,
          );
          return { count: 0 };
        }),
      },
    };
    const service = new AuditRetentionService(prisma as never);
    await service.purgeExpired();
  });
});
