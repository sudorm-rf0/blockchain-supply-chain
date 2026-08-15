import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditRecordInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: input.actorId ?? null,
          actorEmail: input.actorEmail ?? null,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `failed to write audit log ${input.action}: ${String(error)}`,
      );
    }
  }

  private buildWhere(params: {
    action?: string;
    targetType?: string;
    actorEmail?: string;
    keyword?: string;
    from?: string;
    to?: string;
  }): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    if (params.action) where.action = params.action;
    if (params.targetType) where.targetType = params.targetType;
    if (params.actorEmail) {
      where.actorEmail = { contains: params.actorEmail, mode: "insensitive" };
    }
    if (params.keyword) {
      const kw = params.keyword;
      where.OR = [
        { actorEmail: { contains: kw, mode: "insensitive" } },
        { action: { contains: kw, mode: "insensitive" } },
        { targetType: { contains: kw, mode: "insensitive" } },
        { targetId: { contains: kw, mode: "insensitive" } },
      ];
    }
    if (params.from || params.to) {
      const range: { gte?: Date; lte?: Date } = {};
      const from = params.from ? new Date(params.from) : null;
      const to = params.to ? new Date(params.to) : null;
      if (from && !Number.isNaN(from.getTime())) range.gte = from;
      if (to && !Number.isNaN(to.getTime())) range.lte = to;
      if (range.gte || range.lte) where.createdAt = range;
    }
    return where;
  }

  async list(params: {
    page: number;
    limit: number;
    action?: string;
    targetType?: string;
    actorEmail?: string;
    keyword?: string;
    from?: string;
    to?: string;
  }) {
    const where = this.buildWhere(params);
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        actorId: item.actorId,
        actorEmail: item.actorEmail,
        action: item.action,
        targetType: item.targetType,
        targetId: item.targetId,
        metadata: item.metadata,
        createdAt: item.createdAt.toISOString(),
      })),
      total,
      page: params.page,
      limit: params.limit,
    };
  }

  exportCsv(params: {
    action?: string;
    targetType?: string;
    actorEmail?: string;
    keyword?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Readable {
    const where = this.buildWhere(params);
    const limit = params.limit ?? 10_000;
    const batchSize = 2_000;
    const prisma = this.prisma;
    const escape = (value: unknown): string => {
      const text = value === null || value === undefined ? "" : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const header = ["id", "createdAt", "actorId", "actorEmail", "action", "targetType", "targetId", "metadata"];
    const rowOf = (item: {
      id: string;
      createdAt: Date;
      actorId: string | null;
      actorEmail: string | null;
      action: string;
      targetType: string;
      targetId: string;
      metadata: Prisma.JsonValue | null;
    }): string =>
      [
        item.id,
        item.createdAt.toISOString(),
        item.actorId,
        item.actorEmail,
        item.action,
        item.targetType,
        item.targetId,
        JSON.stringify(item.metadata ?? {}),
      ]
        .map(escape)
        .join(",");

    async function* generate() {
      yield "\uFEFF" + header.map((h) => `"${h}"`).join(",") + "\n";
      // keyset 分页（审计 B-01）：用唯一主键 id 作游标，避免大数据量下
      // offset 增长的性能退化；orderBy 同时按 createdAt,id 保证稳定排序。
      let emitted = 0;
      let cursor: string | undefined;
      while (emitted < limit) {
        const take = Math.min(batchSize, limit - emitted);
        const items = await prisma.auditLog.findMany({
          where,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          take,
        });
        if (items.length === 0) break;
        for (const item of items) {
          yield rowOf(item) + "\n";
        }
        emitted += items.length;
        cursor = items[items.length - 1].id;
      }
    }

    return Readable.from(generate());
  }
}
