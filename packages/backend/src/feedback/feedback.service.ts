import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Resend } from "resend";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "@supply-chain/common";
import { AuditService } from "../audit/audit.service";
import type { SubmitFeedbackDto } from "./feedback.dto";

/** 同一用户反馈冷却：60 秒；每天最多 10 条 */
const COOLDOWN_SECONDS = 60;
const MAX_PER_DAY = 10;

export interface FeedbackItem {
  id: string;
  userId: string | null;
  userEmail: string | null;
  contact: string | null;
  content: string;
  status: string;
  processedAt: string | null;
  createdAt: string;
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly to: string;
  private readonly emailEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {
    const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
    this.from = process.env.RESEND_FROM?.trim() || "SupplyChain <onboarding@resend.dev>";
    // 接收邮箱仅在服务端配置，绝不返回给前端/客户端（避免暴露管理员邮箱）。
    this.to = (process.env.FEEDBACK_TO_EMAIL ?? "").trim();
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.emailEnabled = Boolean(this.resend && this.to);
    if (!this.emailEnabled) {
      this.logger.warn(
        "反馈邮件未配置（需要 RESEND_API_KEY + FEEDBACK_TO_EMAIL）：反馈仍会落库，管理员可在后台查看",
      );
    }
  }

  async submit(userId: string, userEmail: string | null, dto: SubmitFeedbackDto) {
    const content = dto.content.trim();
    if (!content) throw new BadRequestException("反馈内容不能为空");

    // 限流：60 秒冷却 + 每天上限（防刷）
    const now = Math.floor(Date.now() / 1000);
    const cooldownKey = `feedback:cooldown:${userId}`;
    const cooldownRaw = await this.redis.get(cooldownKey);
    if (cooldownRaw) {
      const remaining = Number(cooldownRaw) - now;
      if (remaining > 0) {
        throw new BadRequestException(`提交过于频繁，请 ${Math.ceil(remaining)} 秒后再试`);
      }
    }
    const dayBucket = Math.floor(now / 86400);
    const dayKey = `feedback:day:${userId}:${dayBucket}`;
    const sentToday = await this.redis.incr(dayKey);
    if (sentToday === 1) {
      await this.redis.expire(dayKey, 86400);
    }
    if (sentToday > MAX_PER_DAY) {
      throw new BadRequestException("今日反馈次数已达上限，请明天再试");
    }
    await this.redis.setEx(cooldownKey, COOLDOWN_SECONDS, String(now + COOLDOWN_SECONDS));

    const contact = (dto.contact ?? "").trim() || null;
    // 1) 先落库（持久化，管理后台可查看/处理，不依赖邮件）
    const record = await this.prisma.feedback.create({
      data: {
        userId,
        userEmail,
        contact,
        content,
        status: "NEW",
      },
    });

    // 2) 邮件作为通知通道：未配置/失败不阻塞（反馈已入库，后台可见）
    if (this.emailEnabled) {
      const lines = [
        `用户 ID：${userId}`,
        `用户邮箱：${userEmail ?? "未绑定"}`,
        `联系方式：${contact ?? "未填写"}`,
        "",
        "反馈内容：",
        content,
      ].join("\n");
      try {
        const { error } = await this.resend!.emails.send({
          from: this.from,
          to: [this.to],
          subject: `[用户反馈] ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
          text: lines,
        });
        if (error) {
          this.logger.error(`feedback email send failed: ${error.message}`);
        }
      } catch (error) {
        this.logger.error(`feedback email threw: ${String(error)}`);
      }
    }

    await this.audit.record({
      actorId: userId,
      actorEmail: userEmail ?? undefined,
      action: "FEEDBACK_SUBMITTED",
      targetType: "FEEDBACK",
      targetId: record.id,
      metadata: { contact: contact ?? "", chars: content.length },
    });
    return { ok: true };
  }

  /** 管理端：反馈列表（可按状态过滤） */
  async list(status?: string): Promise<FeedbackItem[]> {
    const where =
      status && status !== "ALL" ? { status } : undefined;
    const rows = await this.prisma.feedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userEmail: r.userEmail,
      contact: r.contact,
      content: r.content,
      status: r.status,
      processedAt: r.processedAt ? r.processedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** 管理端：标记反馈已处理 */
  async markProcessed(id: string) {
    const existing = await this.prisma.feedback.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("反馈不存在");
    const updated = await this.prisma.feedback.update({
      where: { id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    return {
      ok: true,
      id: updated.id,
      status: updated.status,
      processedAt: updated.processedAt?.toISOString() ?? null,
    };
  }
}
