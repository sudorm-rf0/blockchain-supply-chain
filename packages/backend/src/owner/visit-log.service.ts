import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

export interface VisitRecord {
  ip?: string;
  userAgent?: string;
  path: string;
  method: string;
  statusCode: number;
  referrer?: string;
  userId?: string;
  durationMs: number;
}

const RETENTION_DAYS = 30;

@Injectable()
export class VisitLogService {
  private readonly logger = new Logger(VisitLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 记录一次访问（写入失败静默降级，不影响业务请求） */
  async record(v: VisitRecord): Promise<void> {
    try {
      await this.prisma.visitLog.create({
        data: {
          ip: v.ip?.slice(0, 64) ?? null,
          userAgent: v.userAgent?.slice(0, 300) ?? null,
          path: v.path.slice(0, 500),
          method: v.method,
          statusCode: v.statusCode,
          referrer: v.referrer?.slice(0, 500) ?? null,
          userId: v.userId ?? null,
          durationMs: v.durationMs,
        },
      });
    } catch (e) {
      this.logger.warn(`visit log write failed: ${String(e)}`);
    }
  }

  /** 每天清理超过保留期的访问记录 */
  @Cron("0 10 * * *")
  async purgeOld(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
      const { count } = await this.prisma.visitLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (count > 0) {
        this.logger.log(`visit logs purged: ${count} (>${RETENTION_DAYS}d)`);
      }
    } catch (e) {
      this.logger.warn(`visit log purge failed: ${String(e)}`);
    }
  }

  /** 访问汇总（今日/24h/7d） */
  async summary() {
    const now = Date.now();
    const day = 86_400_000;
    const ranges = {
      today: new Date(new Date().setHours(0, 0, 0, 0)),
      "24h": new Date(now - day),
      "7d": new Date(now - 7 * day),
    };
    const [today, h24, d7] = await Promise.all([
      this.rangeStats(ranges.today),
      this.rangeStats(ranges["24h"]),
      this.rangeStats(ranges["7d"]),
    ]);
    // 热门页面 / 热门 IP / 错误 / 慢接口（近 7 天）
    const topPages = await this.prisma.visitLog.groupBy({
      by: ["path"],
      where: { createdAt: { gte: ranges["7d"] } },
      _count: { _all: true },
      orderBy: { _count: { path: "desc" } },
      take: 10,
    });
    const topIps = await this.prisma.visitLog.groupBy({
      by: ["ip"],
      where: { createdAt: { gte: ranges["7d"] }, ip: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { ip: "desc" } },
      take: 10,
    });
    const errors = await this.prisma.visitLog.groupBy({
      by: ["statusCode"],
      where: { createdAt: { gte: ranges["7d"] }, statusCode: { gte: 400 } },
      _count: { _all: true },
      orderBy: { _count: { statusCode: "desc" } },
      take: 10,
    });
    const slow = await this.prisma.visitLog.groupBy({
      by: ["path"],
      where: { createdAt: { gte: ranges["7d"] } },
      _avg: { durationMs: true },
      _count: { _all: true },
      orderBy: { _avg: { durationMs: "desc" } },
      take: 10,
    });
    return {
      ranges: {
        today: { ...today, label: "今日" },
        "24h": { ...h24, label: "24 小时" },
        "7d": { ...d7, label: "7 天" },
      },
      topPages: topPages.map((r) => ({ path: r.path, count: r._count._all })),
      topIps: topIps.map((r) => ({ ip: r.ip, count: r._count._all })),
      errors: errors.map((r) => ({ statusCode: r.statusCode, count: r._count._all })),
      slow: slow.map((r) => ({
        path: r.path,
        avgMs: Math.round((r._avg.durationMs ?? 0) * 10) / 10,
        count: r._count._all,
      })),
    };
  }

  private async rangeStats(since: Date) {
    const [total, uniqueIps, users] = await Promise.all([
      this.prisma.visitLog.count({ where: { createdAt: { gte: since } } }),
      this.prisma.visitLog.findMany({
        where: { createdAt: { gte: since }, ip: { not: null } },
        distinct: ["ip"],
        select: { ip: true },
      }),
      this.prisma.visitLog.count({
        where: { createdAt: { gte: since }, userId: { not: null } },
      }),
    ]);
    return { visits: total, uniqueIps: uniqueIps.length, loggedInVisits: users };
  }

  /** 访问明细（分页 + 筛选） */
  async list(opts: { page: number; limit: number; ip?: string; path?: string }) {
    const where = {
      ...(opts.ip ? { ip: { contains: opts.ip } } : {}),
      ...(opts.path ? { path: { contains: opts.path } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.visitLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
        select: {
          id: true,
          ip: true,
          userAgent: true,
          path: true,
          method: true,
          statusCode: true,
          referrer: true,
          userId: true,
          durationMs: true,
          createdAt: true,
        },
      }),
      this.prisma.visitLog.count({ where }),
    ]);
    return { items, total, page: opts.page, limit: opts.limit };
  }

  /** 站长信息：服务器 + 站点概览 */
  async webmaster() {
    const os = await import("node:os");
    const uptime = Math.floor(os.uptime());
    const mem = {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
    };
    const loadavg = os.loadavg();
    const cpus = os.cpus().length;
    const now = Date.now();
    const day = 86_400_000;
    const [users, files, deals, financing, pendingFiles, audits24h, err24h] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.file.count(),
        this.prisma.tradeDeal.count(),
        this.prisma.financingRequest.count(),
        this.prisma.file.count({ where: { status: "PENDING" } }),
        this.prisma.auditLog.count({ where: { createdAt: { gte: new Date(now - day) } } }),
        this.prisma.visitLog.count({
          where: { createdAt: { gte: new Date(now - day) }, statusCode: { gte: 400 } },
        }),
      ]);
    return {
      server: {
        hostname: os.hostname(),
        uptimeSeconds: uptime,
        uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        platform: `${os.platform()} ${os.arch()}`,
        node: process.version,
        cpus,
        loadavg,
        memoryMb: {
          total: Math.round(mem.total / 1024 / 1024),
          free: Math.round(mem.free / 1024 / 1024),
          used: Math.round(mem.used / 1024 / 1024),
        },
      },
      site: {
        users,
        files,
        deals,
        financing,
        pendingFiles,
        audits24h,
        errors24h: err24h,
      },
    };
  }
}
