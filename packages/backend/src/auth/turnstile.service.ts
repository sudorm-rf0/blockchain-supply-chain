import { Injectable, Logger } from "@nestjs/common";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface VerifyOptions {
  remoteIp?: string;
  /** 期望的 widget action（如 login / signup），siteverify 返回的 action 必须匹配 */
  expectedAction?: string;
}

/**
 * Cloudflare Turnstile 人机验证（canonical siteverify）。
 * - TURNSTILE_SECRET 未配置时跳过校验（仅开发/过渡期），并记录警告。
 * - 配置后采用 fail-closed：success !== true、action 不匹配、
 *   hostname 不在 TURNSTILE_HOSTNAMES 白名单、或 API 异常，一律拒绝。
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private readonly secret = process.env.TURNSTILE_SECRET ?? "";
  private readonly enabled = this.secret.length > 0;
  private readonly allowedHostnames = new Set(
    (process.env.TURNSTILE_HOSTNAMES ?? "")
      .split(",")
      .map((hostname) => hostname.trim())
      .filter(Boolean),
  );

  constructor() {
    if (!this.enabled) {
      this.logger.warn(
        "TURNSTILE_SECRET 未配置，人机验证当前处于跳过状态（仅建议开发/过渡期使用）",
      );
    } else if (this.allowedHostnames.size === 0) {
      this.logger.warn(
        "TURNSTILE_HOSTNAMES 未配置，人机验证将拒绝所有请求（fail-closed）",
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async verify(
    token: string | undefined,
    options: VerifyOptions = {},
  ): Promise<boolean> {
    if (!this.enabled) {
      return true;
    }
    if (
      typeof token !== "string" ||
      token.length === 0 ||
      token.length > 2048
    ) {
      this.logger.warn("turnstile: missing or invalid token");
      return false;
    }
    if (this.allowedHostnames.size === 0) {
      this.logger.error("turnstile: TURNSTILE_HOSTNAMES not configured");
      return false;
    }
    try {
      const body = new URLSearchParams({
        secret: this.secret,
        response: token,
      });
      if (options.remoteIp) {
        body.set("remoteip", options.remoteIp);
      }
      const resp = await fetch(SITEVERIFY_URL, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        this.logger.error(`turnstile: siteverify HTTP ${resp.status}`);
        return false;
      }
      const result = (await resp.json()) as {
        success?: boolean;
        action?: string;
        hostname?: string;
        "error-codes"?: string[];
      };
      if (result.success !== true) {
        this.logger.warn(
          `turnstile: verify failed codes=${JSON.stringify(result["error-codes"] ?? [])}`,
        );
        return false;
      }
      if (
        options.expectedAction &&
        result.action !== options.expectedAction
      ) {
        this.logger.warn(
          `turnstile: action mismatch expected=${options.expectedAction} got=${result.action}`,
        );
        return false;
      }
      if (
        !result.hostname ||
        !this.allowedHostnames.has(result.hostname)
      ) {
        this.logger.warn(
          `turnstile: hostname not allowed got=${result.hostname}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(`turnstile: verify error ${String(error)}`);
      return false;
    }
  }
}
