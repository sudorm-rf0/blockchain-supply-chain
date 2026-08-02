import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { AdminGuard } from "../auth/admin.guard";
import { PrismaService } from "../prisma/prisma.service";

@Controller("api/admin/stats")
@UseGuards(AuthGuard, AdminGuard)
export class AdminStatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async stats() {
    const [
      users,
      files,
      deals,
      withdrawals,
      auditLast24h,
      pendingFiles,
    ] = await Promise.all([
      this.prisma.user.groupBy({ by: ["role"], _count: true }),
      this.prisma.file.groupBy({ by: ["status"], _count: true }),
      this.prisma.tradeDeal.groupBy({ by: ["status"], _count: true }),
      this.prisma.withdrawRequest.groupBy({ by: ["status"], _count: true }),
      this.prisma.auditLog.count({
        where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } },
      }),
      this.prisma.file.count({ where: { status: "PENDING" } }),
    ]);

    const countBy = <T extends string>(
      rows: Array<{ [key: string]: string; _count: number }>,
    ) =>
      Object.fromEntries(rows.map((row) => [row[Object.keys(row)[0]], row._count]));

    return {
      users: countBy(users as never),
      files: countBy(files as never),
      deals: countBy(deals as never),
      withdrawals: countBy(withdrawals as never),
      auditLast24h,
      pendingFiles,
    };
  }
}
