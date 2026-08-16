import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  metadata?: unknown;
}

export interface BroadcastNotificationInput {
  creatorId: string;
  title: string;
  body?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 创建定向通知（供业务模块在审核/状态变更时调用） */
  async create(input: CreateNotificationInput) {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        metadata: (input.metadata ?? undefined) as never,
      },
    });
  }

  /** 发布全站通知（userId=null + broadcast=true + creatorId 留痕） */
  async broadcast(input: BroadcastNotificationInput) {
    const title = (input.title ?? "").trim();
    if (!title || title.length > 200) {
      throw new NotFoundException("通知标题不能为空且不超过 200 字符");
    }
    const body = (input.body ?? "").trim();
    return this.prisma.notification.create({
      data: {
        userId: null,
        type: "BROADCAST",
        title,
        body: body || null,
        broadcast: true,
        creatorId: input.creatorId,
      },
    });
  }

  /** 列表：本人定向通知 + 全站广播通知（附带本人已读状态） */
  async list(userId: string, page = 1, limit = 20) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));
    const where = {
      OR: [{ userId }, { broadcast: true }],
    };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        include: {
          creator: { select: { name: true, email: true } },
          reads: { where: { userId }, select: { readAt: true } },
        },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return {
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        broadcast: n.broadcast,
        metadata: n.metadata,
        createdAt: n.createdAt.toISOString(),
        readAt: n.broadcast
          ? (n.reads[0]?.readAt?.toISOString() ?? null)
          : n.readAt?.toISOString() ?? null,
        creatorName: n.creator?.name ?? null,
        creatorEmail: n.creator?.email ?? null,
      })),
      total,
      page: safePage,
      limit: safeLimit,
      unread: await this.unreadCount(userId),
    };
  }

  /** 返回最新未读的全站广播通知（用于横幅展示） */
  async banner(userId: string) {
    const n = await this.prisma.notification.findFirst({
      where: { broadcast: true, reads: { none: { userId } } },
      orderBy: { createdAt: "desc" },
      include: {
        creator: { select: { name: true, email: true } },
      },
    });
    if (!n) return { notification: null };
    return {
      notification: {
        id: n.id,
        title: n.title,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
        creatorName: n.creator?.name ?? null,
      },
    };
  }

  async unreadCount(userId: string) {
    const [direct, broadcasts] = await Promise.all([
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      this.prisma.notification.count({
        where: { broadcast: true, reads: { none: { userId } } },
      }),
    ]);
    return direct + broadcasts;
  }

  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
      select: { broadcast: true, userId: true },
    });
    if (!notification) throw new NotFoundException("通知不存在");
    if (notification.broadcast) {
      // 全站通知：按用户写入已读记录
      await this.prisma.notificationRead.upsert({
        where: { notificationId_userId: { notificationId: id, userId } },
        update: {},
        create: { notificationId: id, userId },
      });
      return { ok: true };
    }
    if (notification.userId !== userId) {
      throw new NotFoundException("通知不存在或已读");
    }
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    // 全站通知：批量写入已读记录（不存在才创建）
    const unreadBroadcasts = await this.prisma.notification.findMany({
      where: { broadcast: true, reads: { none: { userId } } },
      select: { id: true },
      take: 200,
    });
    if (unreadBroadcasts.length > 0) {
      await this.prisma.notificationRead.createMany({
        data: unreadBroadcasts.map((n) => ({ notificationId: n.id, userId })),
        skipDuplicates: true,
      });
    }
    return { ok: true };
  }
}
