import { Injectable, Logger } from "@nestjs/common";
import { createSignedWebhook } from "@supply-chain/common";

@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);

  /**
   * 发送 IM/邮件等 Webhook 通知。REPAYMENT_NOTIFY_URL 未配置时跳过；
   * 配置后最多重试 3 次，均失败则抛错由调用方记录。
   */
  async send(kind: string, payload: Record<string, unknown>): Promise<void> {
    const url = process.env.REPAYMENT_NOTIFY_URL;
    if (!url) {
      this.logger.log(`notification skipped: REPAYMENT_NOTIFY_URL not set`);
      return;
    }
    const body = JSON.stringify({
      kind,
      ...payload,
      occurredAt: new Date().toISOString(),
    });
    // OFF-AUTH-1 / OFF-WH-1：URL 配置后签名密钥不允许为空（fail-closed），
    // 签名串含 nonce，接收方可做重放去重 + 时间窗校验。
    const secret = process.env.WEBHOOK_SECRET ?? "";
    if (!secret) {
      throw new Error(
        "WEBHOOK_SECRET must be set when REPAYMENT_NOTIFY_URL is configured",
      );
    }
    if (
      process.env.NODE_ENV === "production" &&
      secret.length < 32
    ) {
      throw new Error("WEBHOOK_SECRET must be >= 32 chars in production");
    }
    const { signature, timestamp, nonce } = createSignedWebhook(secret, body);
    const maxAttempts = 3;
    const delayMs = Number(process.env.WEBHOOK_RETRY_DELAY_MS ?? 300);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-webhook-signature": signature,
            "x-webhook-timestamp": String(timestamp),
            "x-webhook-nonce": nonce,
          },
          body,
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) {
          throw new Error(`notify endpoint responded ${response.status}`);
        }
        this.logger.log(`${kind} notification delivered`);
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error;
        }
        this.logger.warn(
          `${kind} notification attempt ${attempt}/${maxAttempts} failed: ${String(error)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
}
