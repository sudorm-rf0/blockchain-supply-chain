import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { RedisService } from "@supply-chain/common";
import { AuditService } from "../audit/audit.service";

/** 验证码有效期：5 分钟 */
const CODE_TTL_SECONDS = 5 * 60;
/** 同一邮箱发送冷却：60 秒 */
const COOLDOWN_SECONDS = 60;
/** 同一邮箱每小时发送上限 */
const MAX_SENDS_PER_HOUR = 5;
/** 全站每分钟发送上限（防多邮箱轰炸消耗邮件配额/费用） */
const GLOBAL_MAX_SENDS_PER_MINUTE = 20;
/** 单次验证码最多可尝试次数（超出即作废） */
const MAX_ATTEMPTS = 5;
/** 验证码位数 */
const CODE_LENGTH = 6;

/** 邮件语言：简体 / 繁体 / 英文 */
export type EmailLocale = "zh-CN" | "zh-TW" | "en";

/** 规范化语言：仅接受 zh-CN / zh-TW / en，其余（含 undefined）回退简体 */
export function normalizeLocale(lang?: string | null): EmailLocale {
  if (lang === "zh-TW") return "zh-TW";
  if (lang === "en") return "en";
  return "zh-CN";
}

/** 各语言邮件文案 */
const EMAIL_I18N: Record<
  EmailLocale,
  { subject: string; greeting: string; tip: string; footer: string }
> = {
  "zh-CN": {
    subject: "DFR 供应链金融平台 · 邮箱验证码",
    greeting: "您正在使用邮箱验证，本次验证码为：",
    tip: `验证码 ${CODE_TTL_SECONDS / 60} 分钟内有效，且只能使用一次，请勿泄露给他人。`,
    footer: "如非本人操作，请忽略此邮件。",
  },
  "zh-TW": {
    subject: "DFR 供應鏈金融平台 · 郵箱驗證碼",
    greeting: "您正在使用郵箱驗證，本次驗證碼為：",
    tip: `驗證碼 ${CODE_TTL_SECONDS / 60} 分鐘內有效，且只能使用一次，請勿洩露給他人。`,
    footer: "如非本人操作，請忽略此郵件。",
  },
  en: {
    subject: "DFR Supply Chain Platform · Email Verification Code",
    greeting: "You are verifying your email. Your verification code is:",
    tip: `The code expires in ${CODE_TTL_SECONDS / 60} minutes and can only be used once. Do not share it with anyone.`,
    footer: "If you did not request this, you can safely ignore this email.",
  },
};

interface StoredCode {
  code: string;
  attempts: number;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isCodeEqual(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

/**
 * 邮箱验证码服务（Resend）。
 *
 * - `POST send`：生成 6 位数字验证码存入 Redis（5 分钟有效、单次使用），
 *   并通过 Resend 发送邮件。同一邮箱 60 秒冷却、每小时最多 5 封。
 * - `POST verify`：校验验证码（timing-safe 比较），最多 5 次尝试，成功即作废。
 *
 * 未配置 `RESEND_API_KEY` 时：生产环境直接返回 503（fail-closed）；
 * 开发环境仅记录日志并返回 `devCode`，便于本地联调。
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly enabled: boolean;

  constructor(
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {
    const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
    this.enabled = apiKey.length > 0;
    this.from =
      process.env.RESEND_FROM?.trim() || "SupplyChain <onboarding@resend.dev>";
    if (!this.enabled) {
      this.logger.warn(
        "RESEND_API_KEY 未配置：邮件发送停用（生产环境返回 503，开发环境返回 devCode）",
      );
    }
    this.resend = this.enabled ? new Resend(apiKey) : null;
  }

  // 说明：不在此处强制 Turnstile——注册/登录入口已有人机验证，且该接口被
  // 注册/登录内部流程调用（无 token 会误伤）；防滥用由 60s 冷却 + 每小时上限 + 全局限流 + IP 限流兜底。
  async sendCode(
    email: string,
    lang?: string | null,
  ): Promise<{
    expiresIn: number;
    cooldownSeconds: number;
    devCode?: string;
  }> {
    const normalized = normalizeEmail(email);
    const digest = sha256(normalized);
    const nowSeconds = Math.floor(Date.now() / 1000);

    // 1) 发送冷却：同一邮箱 60 秒内不可重复发送
    const cooldownKey = `email-code:cooldown:${digest}`;
    const cooldownRaw = await this.redis.get(cooldownKey);
    if (cooldownRaw) {
      const remaining = Number(cooldownRaw) - nowSeconds;
      if (remaining > 0) {
        throw new BadRequestException(
          `发送过于频繁，请 ${Math.ceil(remaining)} 秒后重试`,
        );
      }
    }

    // 2) 每小时发送上限：同一邮箱最多 MAX_SENDS_PER_HOUR 封
    const hourBucket = Math.floor(nowSeconds / 3600);
    const rateKey = `email-code:rl:${digest}:${hourBucket}`;
    const sent = await this.redis.incr(rateKey);
    if (sent === 1) {
      await this.redis.expire(rateKey, 3600);
    }
    if (sent > MAX_SENDS_PER_HOUR) {
      throw new BadRequestException("该邮箱发送过于频繁，请 1 小时后再试");
    }

    // 2.5) 全局限流：防多邮箱轰炸（邮件费用滥用），与 IP 限流/单邮箱冷却叠加
    const minuteBucket = Math.floor(nowSeconds / 60);
    const globalKey = `email-code:global-rl:${minuteBucket}`;
    const globalSent = await this.redis.incr(globalKey);
    if (globalSent === 1) {
      await this.redis.expire(globalKey, 120);
    }
    if (globalSent > GLOBAL_MAX_SENDS_PER_MINUTE) {
      throw new BadRequestException("系统繁忙，请稍后再试");
    }

    // 3) 生成验证码并入库（5 分钟有效、单次使用）
    const code = randomInt(0, 10 ** CODE_LENGTH)
      .toString()
      .padStart(CODE_LENGTH, "0");
    const stored: StoredCode = { code, attempts: 0 };
    const codeKey = `email-code:code:${digest}`;
    await this.redis.setEx(
      codeKey,
      CODE_TTL_SECONDS,
      JSON.stringify(stored),
    );

    // 4) 未配置邮件服务：默认 fail-closed；仅当显式设置 ALLOW_DEVCODE=1 才签发 devCode
    //    （审计 P0-3：非生产标记部署即泄露 OTP → 账号接管；改为显式开关，任何环境默认安全）
    if (!this.resend) {
      const allowDevCode = (process.env.ALLOW_DEVCODE ?? "").trim() === "1";
      if (!allowDevCode) {
        throw new ServiceUnavailableException("邮件服务未配置，请联系管理员");
      }
      this.logger.warn(
        `[dev] ALLOW_DEVCODE=1，验证码=${code} 仅记录日志：${normalized}`,
      );
      await this.audit.record({
        actorEmail: normalized,
        action: "EMAIL_CODE_SENT",
        targetType: "EMAIL_VERIFICATION",
        targetId: normalized,
      });
      // 发送成功（或开发模式签发 devCode）后开启冷却
      await this.redis.setEx(
        cooldownKey,
        COOLDOWN_SECONDS,
        String(nowSeconds + COOLDOWN_SECONDS),
      );
      return {
        expiresIn: CODE_TTL_SECONDS,
        cooldownSeconds: COOLDOWN_SECONDS,
        devCode: code,
      };
    }

    // 5) 通过 Resend 发送
    try {
      const locale = normalizeLocale(lang);
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to: [normalized],
        subject: EMAIL_I18N[locale].subject,
        html: this.renderCodeEmail(locale, code),
      });
      if (error) {
        this.logger.error(`resend send failed: ${error.message}`);
        throw new ServiceUnavailableException("邮件发送失败，请稍后重试");
      }
      this.logger.log(
        `verification email sent id=${data?.id ?? "unknown"} to=${normalized}`,
      );
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      this.logger.error(`resend send threw: ${String(error)}`);
      throw new ServiceUnavailableException("邮件发送失败，请稍后重试");
    }

    await this.audit.record({
      actorEmail: normalized,
      action: "EMAIL_CODE_SENT",
      targetType: "EMAIL_VERIFICATION",
      targetId: normalized,
    });

    // 6) 发送成功后开启冷却
    await this.redis.setEx(
      cooldownKey,
      COOLDOWN_SECONDS,
      String(nowSeconds + COOLDOWN_SECONDS),
    );

    return { expiresIn: CODE_TTL_SECONDS, cooldownSeconds: COOLDOWN_SECONDS };
  }

  async verifyCode(
    email: string,
    code: string,
  ): Promise<{ verified: true; email: string }> {
    const normalized = normalizeEmail(email);
    const digest = sha256(normalized);
    const codeKey = `email-code:code:${digest}`;
    const raw = await this.redis.get(codeKey);
    if (!raw) {
      throw new BadRequestException("验证码不存在或已过期，请重新获取");
    }

    let stored: StoredCode;
    try {
      stored = JSON.parse(raw) as StoredCode;
    } catch {
      await this.redis.del(codeKey);
      throw new BadRequestException("验证码不存在或已过期，请重新获取");
    }
    if (
      typeof stored.code !== "string" ||
      typeof stored.attempts !== "number"
    ) {
      await this.redis.del(codeKey);
      throw new BadRequestException("验证码不存在或已过期，请重新获取");
    }

    if (stored.attempts >= MAX_ATTEMPTS) {
      await this.redis.del(codeKey);
      throw new BadRequestException("验证码尝试次数过多，请重新获取");
    }

    if (!/^\d{6}$/.test(code) || !isCodeEqual(stored.code, code)) {
      stored.attempts += 1;
      await this.redis.setEx(
        codeKey,
        CODE_TTL_SECONDS,
        JSON.stringify(stored),
      );
      throw new BadRequestException("验证码错误");
    }

    // 验证通过：单次使用，立即作废
    await this.redis.del(codeKey);
    await this.audit.record({
      actorEmail: normalized,
      action: "EMAIL_CODE_VERIFIED",
      targetType: "EMAIL_VERIFICATION",
      targetId: normalized,
    });
    return { verified: true, email: normalized };
  }

  private renderCodeEmail(locale: EmailLocale, code: string): string {
    const t = EMAIL_I18N[locale];
    return `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937;">
        <h2 style="margin:0 0 16px;font-size:20px;">${t.subject}</h2>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">${t.greeting}</p>
        <p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:6px;color:#2563eb;">${code}</p>
        <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.6;">${t.tip}</p>
        <p style="margin:0;font-size:13px;color:#9ca3af;">${t.footer}</p>
      </div>`;
  }
}
