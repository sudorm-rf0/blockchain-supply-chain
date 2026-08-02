import { AuditService } from "./audit.service";

function makePrisma() {
  return {
    auditLog: {
      create: jest.fn(async () => ({ id: "log-1" })),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
  };
}

describe("AuditService", () => {
  it("records an audit entry", async () => {
    const prisma = makePrisma();
    const service = new AuditService(prisma as never);
    await service.record({
      actorId: "user-1",
      action: "FILE_APPROVED",
      targetType: "FILE",
      targetId: "file-1",
      metadata: { from: "PENDING" },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: "user-1",
          action: "FILE_APPROVED",
          targetId: "file-1",
        }),
      }),
    );
  });

  it("does not throw when persistence fails", async () => {
    const prisma = makePrisma();
    prisma.auditLog.create.mockRejectedValueOnce(new Error("db down"));
    const service = new AuditService(prisma as never);
    await expect(
      service.record({
        actorId: "user-1",
        action: "FILE_DELETED",
        targetType: "FILE",
        targetId: "file-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("lists audit entries with pagination", async () => {
    const prisma = makePrisma();
    const service = new AuditService(prisma as never);
    const result = await service.list({ page: 1, limit: 20 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });
});
