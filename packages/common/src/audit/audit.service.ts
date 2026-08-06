import { Inject, Injectable, Logger } from "@nestjs/common";
import { PRISMA_SERVICE, type PrismaQueryLike } from "../types";

export interface AuditRecordInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

/**
 * trade-service 与 pool-service 此前各复制了一份精简版 AuditService（仅 record），
 * 与主后端的增强版（list/exportCsv）不同。此处收敛两份重复实现。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaQueryLike,
  ) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: input.actorId ?? null,
          actorEmail: input.actorEmail ?? null,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          metadata: input.metadata as any,
        },
      });
    } catch (error) {
      this.logger.error(
        `failed to write audit log ${input.action}: ${String(error)}`,
      );
    }
  }
}
