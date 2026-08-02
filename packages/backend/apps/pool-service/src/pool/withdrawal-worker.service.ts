import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class WithdrawalWorkerService {
  private readonly logger = new Logger(WithdrawalWorkerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async markReadyWithdrawals(): Promise<void> {
    const now = new Date();
    const result = await this.prisma.withdrawRequest.updateMany({
      where: {
        status: "PENDING",
        availableAt: { lte: now },
      },
      data: { status: "READY" },
    });
    if (result.count > 0) {
      this.logger.log(`${result.count} withdrawal(s) became READY`);
    }
  }
}
