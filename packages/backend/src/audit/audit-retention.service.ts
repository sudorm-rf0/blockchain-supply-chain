import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_RETENTION_DAYS = 90;

@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger(AuditRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpired(): Promise<void> {
    const rawDays = Number(
      process.env.AUDIT_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS,
    );
    if (!Number.isFinite(rawDays) || rawDays <= 0) {
      return;
    }
    const cutoff = new Date(Date.now() - rawDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(
        `purged ${result.count} audit log(s) older than ${rawDays} days`,
      );
    }
  }
}
