import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    actorId?: string | null;
    actorEmail?: string | null;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: input.actorId ?? null,
          actorEmail: input.actorEmail ?? null,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `failed to write audit log ${input.action}: ${String(error)}`,
      );
    }
  }
}
