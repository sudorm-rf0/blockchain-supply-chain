import { afterEach, describe, expect, it, vi } from "vitest";
import { TRADE_API_URL } from "../env";
import {
  createTrade,
  confirmTrade,
  confirmFundTrade,
  confirmAdvanceTrade,
  confirmRepayTrade,
  confirmDefaultTrade,
  confirmReleaseTrade,
  fetchAllTrades,
} from "../trades-api";

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function mockFetchOk(): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => "{}",
      } as Response;
    }),
  );
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("trades-api 契约", () => {
  it("createTrade POST /api/trades 并携带完整请求体", async () => {
    const { calls } = mockFetchOk();
    await createTrade({
      buyerWallet: "buyer",
      sellerWallet: "seller",
      amount: "100",
      tenor: "30",
    } as never);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${TRADE_API_URL}/api/trades`);
    expect(calls[0].body).toEqual({
      buyerWallet: "buyer",
      sellerWallet: "seller",
      amount: "100",
      tenor: "30",
    });
  });

  it("confirmTrade POST /:id/confirm 携带钱包/金额/签名", async () => {
    const { calls } = mockFetchOk();
    await confirmTrade("t1", {
      buyerWallet: "buyer",
      sellerWallet: "seller",
      amount: "100",
      tenor: "30",
      txSignature: "sig123",
    });
    expect(calls[0].url).toBe(`${TRADE_API_URL}/api/trades/t1/confirm`);
    expect(calls[0].body).toMatchObject({
      txSignature: "sig123",
      buyerWallet: "buyer",
      amount: "100",
    });
  });

  it.each([
    ["confirmFundTrade", confirmFundTrade, "/fund/confirm"],
    ["confirmRepayTrade", confirmRepayTrade, "/repay/confirm"],
    ["confirmDefaultTrade", confirmDefaultTrade, "/default/confirm"],
    ["confirmReleaseTrade", confirmReleaseTrade, "/release/confirm"],
  ] as const)(
    "%s POST %s 携带 txSignature+confirm（与后端 ConfirmSignatureDto 兼容）",
    async (_name, fn, suffix) => {
      const { calls } = mockFetchOk();
      await (fn as (id: string, sig: string) => Promise<unknown>)(
        "t1",
        "4xYJ_signature_80chars_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      expect(calls[0].method).toBe("POST");
      expect(calls[0].url).toBe(`${TRADE_API_URL}/api/trades/t1${suffix}`);
      const body = calls[0].body as Record<string, unknown>;
      expect(body.txSignature).toBe(
        "4xYJ_signature_80chars_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      // 后端 ConfirmSignatureDto 已接受 confirm 可选字段，契约必须保持
      expect(body.confirm).toBe(true);
    },
  );

  it("confirmAdvanceTrade 携带 targetStatus/adminWallet/txSignature", async () => {
    const { calls } = mockFetchOk();
    await confirmAdvanceTrade("t1", 4, "admin-wallet", "sig123");
    expect(calls[0].url).toBe(`${TRADE_API_URL}/api/trades/t1/advance/confirm`);
    expect(calls[0].body).toEqual({
      targetStatus: "4",
      adminWallet: "admin-wallet",
      txSignature: "sig123",
    });
  });

  it("fetchAllTrades 带 status 参数但 ALL 时不带", async () => {
    const { calls } = mockFetchOk();
    await fetchAllTrades({ status: "PENDING" });
    expect(calls[0].url).toBe(`${TRADE_API_URL}/api/trades/admin?status=PENDING`);
    await fetchAllTrades({ status: "ALL" });
    expect(calls[1].url).toBe(`${TRADE_API_URL}/api/trades/admin`);
  });
});
