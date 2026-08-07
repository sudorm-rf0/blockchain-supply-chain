import {
  createSignedWebhook,
  signWebhookPayload,
  verifyWebhookSignature,
} from "@supply-chain/common";

const SECRET = "test-webhook-secret-0123456789abcdef";

describe("webhook signing & verification (OFF-WH-1)", () => {
  it("signs and verifies a valid webhook", () => {
    const body = JSON.stringify({ event: "deal.defaulted", id: "1" });
    const signed = createSignedWebhook(SECRET, body);
    expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body,
        signature: signed.signature,
        timestamp: signed.timestamp,
        nonce: signed.nonce,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ event: "deal.defaulted", id: "1" });
    const signed = createSignedWebhook(SECRET, body);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: JSON.stringify({ event: "deal.defaulted", id: "2" }),
        signature: signed.signature,
        timestamp: signed.timestamp,
        nonce: signed.nonce,
      }),
    ).toBe(false);
  });

  it("rejects a replay outside the timestamp window", () => {
    const body = JSON.stringify({ event: "deal.defaulted", id: "1" });
    const signed = createSignedWebhook(SECRET, body, Date.now() - 10 * 60 * 1000);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body,
        signature: signed.signature,
        timestamp: signed.timestamp,
        nonce: signed.nonce,
      }),
    ).toBe(false);
  });

  it("rejects a wrong nonce", () => {
    const body = JSON.stringify({ event: "deal.defaulted", id: "1" });
    const signed = createSignedWebhook(SECRET, body);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body,
        signature: signed.signature,
        timestamp: signed.timestamp,
        nonce: "deadbeef".repeat(4),
      }),
    ).toBe(false);
  });

  it("rejects a signature from a different secret", () => {
    const body = JSON.stringify({ event: "deal.defaulted", id: "1" });
    const signed = createSignedWebhook(SECRET, body);
    expect(
      verifyWebhookSignature({
        secret: "another-secret-0123456789abcdef",
        body,
        signature: signed.signature,
        timestamp: signed.timestamp,
        nonce: signed.nonce,
      }),
    ).toBe(false);
  });

  it("rejects an empty signing secret", () => {
    expect(() => signWebhookPayload("", "body", Date.now(), "nonce")).toThrow(
      "must not be empty",
    );
    expect(
      verifyWebhookSignature({
        secret: "",
        body: "body",
        signature: "x",
        timestamp: Date.now(),
      }),
    ).toBe(false);
  });
});
