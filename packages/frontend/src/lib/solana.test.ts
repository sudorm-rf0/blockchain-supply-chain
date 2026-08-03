import { describe, expect, it, vi } from "vitest";
import { confirmTransactionWithTimeout } from "./solana";

describe("confirmTransactionWithTimeout", () => {
  it("resolves when the transaction confirms", async () => {
    const connection = {
      getSignatureStatuses: vi.fn().mockResolvedValue({
        value: [{ confirmationStatus: "confirmed" }],
      }),
    };
    await expect(
      confirmTransactionWithTimeout(connection as never, "sig" as never),
    ).resolves.toBeUndefined();
  });

  it("waits for finalized when requested", async () => {
    const statuses = vi
      .fn()
      .mockResolvedValueOnce({
        value: [{ confirmationStatus: "confirmed" }],
      })
      .mockResolvedValueOnce({
        value: [{ confirmationStatus: "finalized" }],
      });
    const connection = { getSignatureStatuses: statuses };
    await expect(
      confirmTransactionWithTimeout(
        connection as never,
        "sig" as never,
        "finalized",
      ),
    ).resolves.toBeUndefined();
    expect(statuses).toHaveBeenCalledTimes(2);
  });

  it("rejects when the cluster returns an error", async () => {
    const connection = {
      getSignatureStatuses: vi
        .fn()
        .mockResolvedValue({ value: [{ err: "failed" }] }),
    };
    await expect(
      confirmTransactionWithTimeout(connection as never, "sig" as never),
    ).rejects.toThrow("rejected by the cluster");
  });

  it("rejects on timeout instead of hanging forever", async () => {
    vi.useFakeTimers();
    try {
      const connection = {
        getSignatureStatuses: vi.fn().mockResolvedValue({
          value: [{ confirmationStatus: "processed" }],
        }),
      };
      const pending = confirmTransactionWithTimeout(
        connection as never,
        "sig" as never,
        "confirmed",
        60,
      );
      const assertion = expect(pending).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(2_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
