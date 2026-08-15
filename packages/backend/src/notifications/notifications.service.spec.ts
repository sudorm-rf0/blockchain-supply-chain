import { NotificationsService } from "./notifications.service";

function makePrisma() {
  const notification = {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  };
  return { notification } as never;
}

describe("NotificationsService", () => {
  it("creates a notification", async () => {
    const prisma = makePrisma() as {
      notification: {
        create: jest.Mock;
        findMany: jest.Mock;
        count: jest.Mock;
        updateMany: jest.Mock;
      };
    };
    const svc = new NotificationsService(prisma as never);
    await svc.create({ userId: "u1", type: "FILE_REVIEWED", title: "审核完成" });
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "u1", type: "FILE_REVIEWED" }),
      }),
    );
  });

  it("lists with unread count", async () => {
    const prisma = makePrisma() as {
      notification: {
        create: jest.Mock;
        findMany: jest.Mock;
        count: jest.Mock;
        updateMany: jest.Mock;
      };
    };
    prisma.notification.findMany.mockResolvedValue([{ id: "n1" }]);
    prisma.notification.count
      .mockResolvedValueOnce(3) // total
      .mockResolvedValueOnce(2); // unread
    const svc = new NotificationsService(prisma as never);
    const out = await svc.list("u1", 1, 20);
    expect(out.total).toBe(3);
    expect(out.unread).toBe(2);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" }, take: 20 }),
    );
  });

  it("marks read only when unread and owned", async () => {
    const prisma = makePrisma() as {
      notification: {
        create: jest.Mock;
        findMany: jest.Mock;
        count: jest.Mock;
        updateMany: jest.Mock;
      };
    };
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    const svc = new NotificationsService(prisma as never);
    await expect(svc.markRead("u1", "n1")).resolves.toEqual({ ok: true });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "n1", userId: "u1", readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it("throws when notification not owned/unread", async () => {
    const prisma = makePrisma() as {
      notification: {
        create: jest.Mock;
        findMany: jest.Mock;
        count: jest.Mock;
        updateMany: jest.Mock;
      };
    };
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    const svc = new NotificationsService(prisma as never);
    await expect(svc.markRead("u1", "n1")).rejects.toThrow("通知不存在或已读");
  });

  it("marks all read", async () => {
    const prisma = makePrisma() as {
      notification: {
        create: jest.Mock;
        findMany: jest.Mock;
        count: jest.Mock;
        updateMany: jest.Mock;
      };
    };
    prisma.notification.updateMany.mockResolvedValue({ count: 5 });
    const svc = new NotificationsService(prisma as never);
    await expect(svc.markAllRead("u1")).resolves.toEqual({ ok: true });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});
