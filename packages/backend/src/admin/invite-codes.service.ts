import { BadRequestException, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

/** 邀请码字符集：去除易混淆的 0/O/1/I/l，仍为数字+大小写字母混合。 */
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 6;
const MAX_GENERATE = 500;

export interface InviteCodeRecord {
  id: string;
  code: string;
  usedAt: Date | null;
  usedByEmail: string | null;
  usedByName: string | null;
  usedByRole: string | null;
  createdAt: Date;
}

@Injectable()
export class InviteCodesService {
  constructor(private readonly prisma: PrismaService) {}

  private randomChar(): string {
    const buf = randomBytes(1);
    return CHARSET[buf[0] % CHARSET.length];
  }

  /** 生成一个 6 位邀请码：保证至少含 1 个数字与 1 个字母。 */
  private randomCode(): string {
    const chars: string[] = [];
    // 随机放一个数字位置与一个字母位置，其余随机，保证"数字+字母混合"
    const numIdx = Math.floor(Math.random() * CODE_LENGTH);
    const letterIdx = (numIdx + 1 + Math.floor(Math.random() * (CODE_LENGTH - 1))) % CODE_LENGTH;
    for (let i = 0; i < CODE_LENGTH; i++) {
      if (i === numIdx) {
        chars.push(String(Math.floor(Math.random() * 10)));
      } else if (i === letterIdx) {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        chars.push(letters[Math.floor(Math.random() * letters.length)]);
      } else {
        chars.push(this.randomChar());
      }
    }
    return chars.join("");
  }

  async generate(count: number, createdById: string): Promise<string[]> {
    if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATE) {
      throw new BadRequestException(`邀请码数量需为 1-${MAX_GENERATE} 的整数`);
    }
    const codes: string[] = [];
    const seen = new Set<string>();
    let attempts = 0;
    while (codes.length < count && attempts < count * 50) {
      attempts += 1;
      const code = this.randomCode();
      if (seen.has(code)) continue;
      const existing = await this.prisma.inviteCode.findUnique({
        where: { code },
        select: { id: true },
      });
      if (existing) continue;
      seen.add(code);
      codes.push(code);
    }
    if (codes.length < count) {
      throw new BadRequestException("生成邀请码失败，请重试");
    }
    await this.prisma.inviteCode.createMany({
      data: codes.map((code) => ({ code, createdById })),
    });
    return codes;
  }


  async stats() {
    const rows = await this.prisma.inviteCode.findMany({
      orderBy: { createdAt: "desc" },
      take: 2000,
      include: {
        usedBy: { select: { email: true, name: true, role: true } },
      },
    });
    const total = rows.length;
    const usedRows = rows.filter((r) => r.usedAt !== null);
    const used = usedRows.length;
    const unused = total - used;
    const usageRate = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;

    // 角色分布（使用人账户类型）
    const byRole: Record<string, number> = {};
    for (const r of usedRows) {
      const role = r.usedBy?.role ?? "UNKNOWN";
      byRole[role] = (byRole[role] ?? 0) + 1;
    }

    // 近 90 天趋势：按天统计生成数 / 使用数（前端可切换 7/30/90 天）
    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const trendMap = new Map<string, { generated: number; used: number }>();
    for (let i = 89; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      trendMap.set(dayKey(d), { generated: 0, used: 0 });
    }
    for (const r of rows) {
      const g = trendMap.get(dayKey(r.createdAt));
      if (g) g.generated += 1;
      if (r.usedAt) {
        const u = trendMap.get(dayKey(r.usedAt));
        if (u) u.used += 1;
      }
    }
    const trend = [...trendMap.entries()].map(([date, v]) => ({ date, ...v }));

    // 按管理员统计：谁生成了多少 / 用了多少（createdById 关联 User）
    const creatorMap = new Map<string, { generated: number; used: number }>();
    for (const r of rows) {
      const key = r.createdById ?? "unknown";
      const cur = creatorMap.get(key) ?? { generated: 0, used: 0 };
      cur.generated += 1;
      if (r.usedAt) cur.used += 1;
      creatorMap.set(key, cur);
    }
    const creatorIds = [...creatorMap.keys()].filter((k) => k !== "unknown");
    const creators = creatorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const byCreator = [...creatorMap.entries()]
      .map(([userId, v]) => {
        const u = creators.find((c) => c.id === userId);
        return {
          userId,
          email: u?.email ?? null,
          name: u?.name ?? null,
          generated: v.generated,
          used: v.used,
          // 管理员使用率：生成后实际被用掉的比例（1 位小数）
          usageRate:
            v.generated > 0 ? Math.round((v.used / v.generated) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.generated - a.generated);

    // 最近使用的邀请码（含使用人信息）
    const recentUsed = usedRows
      .sort((a, b) => (b.usedAt?.getTime() ?? 0) - (a.usedAt?.getTime() ?? 0))
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        code: r.code,
        usedAt: r.usedAt,
        usedByEmail: r.usedBy?.email ?? null,
        usedByName: r.usedBy?.name ?? null,
        usedByRole: r.usedBy?.role ?? null,
      }));

    return { total, used, unused, usageRate, byRole, trend, recentUsed, byCreator };
  }

  async list(): Promise<InviteCodeRecord[]> {
    const rows = await this.prisma.inviteCode.findMany({
      orderBy: { createdAt: "desc" },
      take: 2000,
      include: {
        usedBy: { select: { email: true, name: true, role: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      usedAt: row.usedAt,
      usedByEmail: row.usedBy?.email ?? null,
      usedByName: row.usedBy?.name ?? null,
      usedByRole: row.usedBy?.role ?? null,
      createdAt: row.createdAt,
    }));
  }

}
