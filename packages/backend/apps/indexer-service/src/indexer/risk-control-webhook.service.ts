import { Injectable, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
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
        dealId: deal.dealId.toString(10),
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

    const timestamp = Date.now();
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", INDEXER_ENV.webhookSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const response = await fetch(INDEXER_ENV.riskWebhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": signature,
        "x-webhook-timestamp": String(timestamp),
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`risk webhook responded ${response.status}`);
    }
    this.logger.log(`defaulted webhook delivered for deal ${deal.id}`);
  }
}
