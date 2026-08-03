import { describe, expect, it, vi } from "vitest";
import { confirmTransactionWithTimeout } from "./solana";

describe("confirmTransactionWithTimeout", () => {
  it("resolves when the transaction confirms", async () => {
    const connection = {
      confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
    };
    await expect(
      confirmTransactionWithTimeout(connection as never, "sig" as never),
    ).resolves.toBeUndefined();
  });

  it("rejects when the cluster returns an error", async () => {
    const connection = {
      confirmTransaction: vi
        .fn()
        .mockResolvedValue({ value: { err: "failed" } }),
    };
    await expect(
      confirmTransactionWithTimeout(connection as never, "sig" as never),
    ).rejects.toThrow("rejected by the cluster");
  });

  it("rejects on timeout instead of hanging forever", async () => {
    vi.useFakeTimers();
    try {
      const connection = {
        confirmTransaction: vi.fn().mockReturnValue(new Promise(() => {})),
      };
      const pending = confirmTransactionWithTimeout(
        connection as never,
        "sig" as never,
        "confirmed",
        1_000,
      );
      const assertion = expect(pending).rejects.toThrow("timed out");
      vi.advanceTimersByTime(1_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
