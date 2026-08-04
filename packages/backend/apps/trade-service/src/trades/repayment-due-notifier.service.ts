import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RedisService } from "../redis/redis.service";
import { NotifierService } from "./notifier.service";

const NOTIFY_DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class RepaymentDueNotifierService {
  private readonly logger = new Logger(RepaymentDueNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly notifier: NotifierService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async notifyRepaymentDue(): Promise<void> {
    const now = Date.now();
    const deals = await this.prisma.tradeDeal.findMany({
      where: { status: "REPAYING" },
      select: {
        dealId: true,
        buyerWallet: true,
        sellerWallet: true,
        amount: true,
        createdAt: true,
        tenor: true,
      },
    });

    for (const deal of deals) {
      const dueAt = deal.createdAt.getTime() + Number(deal.tenor) * 1000;
      if (dueAt > now) continue;

      const key = `repay:due:notified:${deal.dealId}`;
      const claimed = await this.redis.setNX(key, "1", NOTIFY_DEDUP_TTL_SECONDS);
      if (!claimed) continue;

      await this.audit.record({
        actorId: null,
        action: "TRADE_REPAYMENT_DUE",
        targetType: "TRADE",
        targetId: deal.dealId,
        metadata: {
          buyerWallet: deal.buyerWallet,
          sellerWallet: deal.sellerWallet,
          amount: deal.amount.toString(10),
          dueAt: new Date(dueAt).toISOString(),
        },
      });
      await this.notifier.send("repayment.due", {
        dealId: deal.dealId,
        buyerWallet: deal.buyerWallet,
        sellerWallet: deal.sellerWallet,
        amount: deal.amount.toString(10),
        dueAt: new Date(dueAt).toISOString(),
      });
      this.logger.warn(
        `repayment due for deal ${deal.dealId} (buyer ${deal.buyerWallet})`,
      );
    }
  }
}
