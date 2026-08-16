import { afterEach, describe, expect, it, vi } from "vitest";
import { POOL_API_URL } from "../env";
import { executeWithdrawal, fetchWithdrawRequests } from "../pool-api";

function mockFetchOk() {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" } as Response;
    }),
  );
  return { calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("pool-api 契约", () => {
  it("fetchWithdrawRequests GET /api/lp/withdraw-requests", async () => {
    const { calls } = mockFetchOk();
    await fetchWithdrawRequests();
    expect(calls[0].url).toBe(`${POOL_API_URL}/api/lp/withdraw-requests`);
    expect(calls[0].method).toBe("GET");
  });

  it("executeWithdrawal POST /:id/execute 携带 txSignature+confirm（与后端 H-5 契约一致）", async () => {
    const { calls } = mockFetchOk();
    await executeWithdrawal("wr-1", "sig123");
    expect(calls[0].url).toBe(
      `${POOL_API_URL}/api/lp/withdraw-request/wr-1/execute`,
    );
    const body = calls[0].body as Record<string, unknown>;
    expect(body.txSignature).toBe("sig123");
    expect(body.confirm).toBe(true);
  });

  it("executeWithdrawal 未传签名时 txSignature 为 undefined（后端会拒绝）", async () => {
    const { calls } = mockFetchOk();
    await executeWithdrawal("wr-1");
    const body = calls[0].body as Record<string, unknown>;
    expect(body.txSignature).toBeUndefined();
    expect(body.confirm).toBe(true);
  });
});
