import { Injectable, Logger } from "@nestjs/common";
import { createSignedWebhook } from "@supply-chain/common";
import { INDEXER_ENV } from "../config/env";
import type { TradeDeal } from "@prisma/client";

@Injectable()
export class RiskControlWebhookService {
  private readonly logger = new Logger(RiskControlWebhookService.name);

  async notifyDefaulted(deal: TradeDeal): Promise<void> {
    const payload = {
      event: "deal.defaulted",
      occurredAt: new Date().toISOString(),
      deal: {
        id: deal.id,
        dealId: deal.dealId,
        buyerWallet: deal.buyerWallet,
        sellerWallet: deal.sellerWallet,
        amount: deal.amount.toString(10),
        downPayment: deal.downPayment.toString(10),
        poolPortion: deal.poolPortion.toString(10),
        tenor: deal.tenor.toString(10),
        status: deal.status,
        txSignature: deal.txSignature,
      },
    };

    const body = JSON.stringify(payload);
    // OFF-AUTH-1 / OFF-WH-1：风控 webhook 的签名密钥不允许为空或 dev 固定值
    // （fail-closed），签名串含 nonce 供接收方重放去重 + 时间窗校验。
    const secret = process.env.WEBHOOK_SECRET ?? "";
    if (!secret) {
      throw new Error("WEBHOOK_SECRET must be set when RISK_WEBHOOK_URL is configured");
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
        const response = await fetch(INDEXER_ENV.riskWebhookUrl, {
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
          throw new Error(`risk webhook responded ${response.status}`);
        }
        this.logger.log(`defaulted webhook delivered for deal ${deal.id}`);
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error;
        }
        this.logger.warn(
          `risk webhook attempt ${attempt}/${maxAttempts} failed: ${String(error)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
}
