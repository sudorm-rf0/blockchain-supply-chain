import { NotificationsService } from "./notifications.service";

function makePrisma() {
  return {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    notificationRead: {
      upsert: jest.fn(),
      createMany: jest.fn(),
    },
  } as never;
}

describe("NotificationsService", () => {
  it("creates a direct notification", async () => {
    const prisma = makePrisma() as {
      notification: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; count: jest.Mock; updateMany: jest.Mock };
      notificationRead: { upsert: jest.Mock; createMany: jest.Mock };
    };
    const svc = new NotificationsService(prisma as never);
    await svc.create({ userId: "u1", type: "FILE_REVIEWED", title: "审核完成" });
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "u1", type: "FILE_REVIEWED" }),
      }),
    );
  });

  it("broadcasts with userId=null and creator", async () => {
    const prisma = makePrisma() as {
      notification: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; count: jest.Mock; updateMany: jest.Mock };
      notificationRead: { upsert: jest.Mock; createMany: jest.Mock };
    };
    prisma.notification.create.mockImplementation(async ({ data }) => ({ id: "b1", ...data }));
    const svc = new NotificationsService(prisma as never);
    const out = await svc.broadcast({ creatorId: "admin1", title: "系统升级通知", body: "今晚维护" });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null, broadcast: true, creatorId: "admin1", type: "BROADCAST" }),
    });
    expect(out.id).toBe("b1");
  });

  it("rejects empty broadcast title", async () => {
    const prisma = makePrisma() as never;
    const svc = new NotificationsService(prisma);
    await expect(svc.broadcast({ creatorId: "a", title: "  " })).rejects.toThrow();
  });

  it("lists direct + broadcast with per-user read state", async () => {
    const prisma = makePrisma() as {
      notification: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; count: jest.Mock; updateMany: jest.Mock };
      notificationRead: { upsert: jest.Mock; createMany: jest.Mock };
    };
    prisma.notification.findMany.mockResolvedValue([
      { id: "b1", type: "BROADCAST", title: "公告", body: null, broadcast: true, metadata: null, createdAt: new Date(), reads: [{ readAt: null }], creator: null },
      { id: "d1", type: "SYSTEM", title: "定向", body: null, broadcast: false, metadata: null, createdAt: new Date(), readAt: null, reads: [], creator: null },
    ]);
    prisma.notification.count
      .mockResolvedValueOnce(2) // total
      .mockResolvedValueOnce(1) // direct unread
      .mockResolvedValueOnce(1); // broadcast unread
    const svc = new NotificationsService(prisma as never);
    const out = await svc.list("u1", 1, 20);
    expect(out.total).toBe(2);
    expect(out.unread).toBe(2);
    // 广播通知附带 reads 过滤
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ userId: "u1" }, { broadcast: true }] },
        include: expect.objectContaining({
          reads: { where: { userId: "u1" }, select: { readAt: true } },
        }),
      }),
    );
  });

  it("marks broadcast read via notification_reads upsert", async () => {
    const prisma = makePrisma() as {
      notification: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; count: jest.Mock; updateMany: jest.Mock };
      notificationRead: { upsert: jest.Mock; createMany: jest.Mock };
    };
    prisma.notification.findUnique.mockResolvedValue({ broadcast: true, userId: null });
    prisma.notificationRead.upsert.mockResolvedValue({});
    const svc = new NotificationsService(prisma as never);
    await expect(svc.markRead("u1", "b1")).resolves.toEqual({ ok: true });
    expect(prisma.notificationRead.upsert).toHaveBeenCalledWith({
      where: { notificationId_userId: { notificationId: "b1", userId: "u1" } },
      update: {},
      create: { notificationId: "b1", userId: "u1" },
    });
  });

  it("marks direct notification read only when owned", async () => {
    const prisma = makePrisma() as {
      notification: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; count: jest.Mock; updateMany: jest.Mock };
      notificationRead: { upsert: jest.Mock; createMany: jest.Mock };
    };
    prisma.notification.findUnique.mockResolvedValue({ broadcast: false, userId: "u1" });
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    const svc = new NotificationsService(prisma as never);
    await expect(svc.markRead("u1", "d1")).resolves.toEqual({ ok: true });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "d1", userId: "u1", readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it("returns latest unread broadcast for banner", async () => {
    const prisma = makePrisma() as {
      notification: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; count: jest.Mock; updateMany: jest.Mock; findFirst: jest.Mock };
      notificationRead: { upsert: jest.Mock; createMany: jest.Mock };
    };
    prisma.notification.findFirst.mockResolvedValue({
      id: "b1",
      title: "维护通知",
      body: "今晚维护",
      createdAt: new Date(),
      creator: { name: "Admin", email: "admin@x" },
    });
    const svc = new NotificationsService(prisma as never);
    const out = await svc.banner("u1");
    expect(out.notification).not.toBeNull();
    expect(out.notification!.title).toBe("维护通知");
    expect(out.notification!.creatorName).toBe("Admin");
    expect(prisma.notification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { broadcast: true, reads: { none: { userId: "u1" } } } }),
    );
  });

  it("returns null banner when no unread broadcast", async () => {
    const prisma = makePrisma() as {
      notification: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; count: jest.Mock; updateMany: jest.Mock; findFirst: jest.Mock };
      notificationRead: { upsert: jest.Mock; createMany: jest.Mock };
    };
    prisma.notification.findFirst.mockResolvedValue(null);
    const svc = new NotificationsService(prisma as never);
    const out = await svc.banner("u1");
    expect(out).toEqual({ notification: null });
  });

  it("marks all read including broadcasts", async () => {
    const prisma = makePrisma() as {
      notification: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; count: jest.Mock; updateMany: jest.Mock };
      notificationRead: { upsert: jest.Mock; createMany: jest.Mock };
    };
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });
    prisma.notification.findMany.mockResolvedValue([{ id: "b1" }, { id: "b2" }]);
    prisma.notificationRead.createMany.mockResolvedValue({ count: 2 });
    const svc = new NotificationsService(prisma as never);
    await expect(svc.markAllRead("u1")).resolves.toEqual({ ok: true });
    expect(prisma.notificationRead.createMany).toHaveBeenCalledWith({
      data: [{ notificationId: "b1", userId: "u1" }, { notificationId: "b2", userId: "u1" }],
      skipDuplicates: true,
    });
  });
});
