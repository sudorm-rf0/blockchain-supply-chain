import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard, AdminGuard } from "@supply-chain/common";
import { PrismaService } from "../prisma/prisma.service";

const AI_ACTIONS = [
  "AI_ASSISTANT_CHAT",
  "FILE_AI_REVIEWED",
  "FILE_AI_EXTRACTED",
  "FILE_AI_SUMMARIZED",
  "FILE_AI_CHAT",
];

const DAY_MS = 24 * 60 * 60 * 1000;

function groupBy<T>(rows: T[], keyFn: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = keyFn(r) || "unknown";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

@ApiTags("admin-ai-stats")
@Controller("api/admin/ai-stats")
@UseGuards(AuthGuard, AdminGuard)
export class AiStatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: "AI 用量统计（管理员）：近 30 天调用汇总" })
  async stats() {
    const since = new Date(Date.now() - 30 * DAY_MS);
    const rows = await this.prisma.auditLog.findMany({
      where: { action: { in: AI_ACTIONS }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const now = Date.now();
    const last24h = rows.filter((r) => r.createdAt.getTime() > now - DAY_MS).length;
    const last7d = rows.filter((r) => r.createdAt.getTime() > now - 7 * DAY_MS).length;

    // 近 14 天按日统计
    const byDay: Array<{ date: string; count: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const dayStart = new Date(now - i * DAY_MS);
      const dayEnd = new Date(now - (i - 1) * DAY_MS);
      const count = rows.filter(
        (r) =>
          r.createdAt.getTime() >= dayStart.getTime() &&
          r.createdAt.getTime() < dayEnd.getTime(),
      ).length;
      byDay.push({
        date: dayStart.toISOString().slice(0, 10),
        count,
      });
    }

    const recent = rows.slice(0, 20).map((r) => {
      const meta = (r.metadata ?? {}) as {
        model?: string;
        question?: string;
      };
      return {
        actorEmail: r.actorEmail,
        action: r.action,
        model: meta.model ?? "unknown",
        question: meta.question ?? "",
        createdAt: r.createdAt.toISOString(),
      };
    });

    return {
      total30d: rows.length,
      last24h,
      last7d,
      byAction: groupBy(rows, (r) => r.action),
      byModel: groupBy(rows, (r) => ((r.metadata ?? {}) as { model?: string }).model ?? "unknown"),
      byDay,
      recent,
    };
  }
}
