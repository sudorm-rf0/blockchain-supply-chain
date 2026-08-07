import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALGORITHM = "sha256";
export const WEBHOOK_DEFAULT_MAX_AGE_MS = 5 * 60 * 1000; // 5 分钟时间窗

export interface SignedWebhook {
  signature: string;
  timestamp: number;
  nonce: string;
}

/**
 * 对 Webhook 载荷做 HMAC-SHA256 签名，签名串为 `${timestamp}.${nonce}.${body}`。
 * nonce 供接收方做重放去重；timestamp 供接收方做时间窗校验。
 */
export function signWebhookPayload(
  secret: string,
  body: string,
  timestamp: number,
  nonce: string,
): string {
  if (!secret) {
    throw new Error("webhook signing secret must not be empty");
  }
  return createHmac(ALGORITHM, secret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest("hex");
}

export function createSignedWebhook(
  secret: string,
  body: string,
  timestamp = Date.now(),
): SignedWebhook {
  const nonce = cryptoRandomHex(16);
  return {
    signature: signWebhookPayload(secret, body, timestamp, nonce),
    timestamp,
    nonce,
  };
}

export interface VerifyWebhookInput {
  secret: string;
  body: string;
  signature: string;
  timestamp: string | number;
  nonce?: string;
  /** 允许的最大时间偏差（毫秒），默认 5 分钟。 */
  maxAgeMs?: number;
  now?: number;
}

/**
 * 接收方校验：常量时间比较签名 + 时间窗防重放。
 * 签名格式与 signWebhookPayload 一致：HMAC-SHA256(`${timestamp}.${nonce}.${body}`)。
 */
export function verifyWebhookSignature(input: VerifyWebhookInput): boolean {
  const { secret, body, signature, timestamp, nonce, maxAgeMs, now } = input;
  if (!secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const current = now ?? Date.now();
  const window = maxAgeMs ?? WEBHOOK_DEFAULT_MAX_AGE_MS;
  if (Math.abs(current - ts) > window) return false; // 过期/未来时间戳 → 拒绝

  const signed = signWebhookPayload(secret, body, ts, nonce ?? "");
  const actual = Buffer.from(signature, "utf8");
  const expected = Buffer.from(signed, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function cryptoRandomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}
