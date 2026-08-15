import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Resend } from "resend";
import { RedisService } from "@supply-chain/common";
import { AuditService } from "../audit/audit.service";
import type { SubmitFeedbackDto } from "./feedback.dto";

/** 同一用户反馈冷却：60 秒；每天最多 10 条 */
const COOLDOWN_SECONDS = 60;
const MAX_PER_DAY = 10;

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly to: string;
  private readonly emailEnabled: boolean;

  constructor(
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
        "反馈邮件未配置（需要 RESEND_API_KEY + FEEDBACK_TO_EMAIL）：提交反馈将返回 503",
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

    const contact = (dto.contact ?? "").trim() || "未填写";
    const lines = [
      `用户 ID：${userId}`,
      `用户邮箱：${userEmail ?? "未绑定"}`,
      `联系方式：${contact}`,
      "",
      "反馈内容：",
      content,
    ].join("\n");

    if (!this.emailEnabled) {
      // fail-closed：收件邮箱/邮件服务未配置时明确报错，避免反馈静默丢失。
      this.logger.error(
        `feedback email not configured (RESEND_API_KEY=${Boolean(this.resend)}, FEEDBACK_TO_EMAIL=${Boolean(this.to)})`,
      );
      throw new ServiceUnavailableException("反馈邮件服务未配置，请联系管理员");
    }
    try {
      const { error } = await this.resend!.emails.send({
        from: this.from,
        to: [this.to],
        subject: `[用户反馈] ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
        text: lines,
      });
      if (error) {
        this.logger.error(`feedback email send failed: ${error.message}`);
        throw new ServiceUnavailableException("反馈邮件发送失败，请稍后重试");
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(`feedback email threw: ${String(error)}`);
      throw new ServiceUnavailableException("反馈邮件发送失败，请稍后重试");
    }

    await this.audit.record({
      actorId: userId,
      actorEmail: userEmail ?? undefined,
      action: "FEEDBACK_SUBMITTED",
      targetType: "FEEDBACK",
      targetId: userId,
      metadata: { contact, chars: content.length },
    });
    return { ok: true };
  }
}
