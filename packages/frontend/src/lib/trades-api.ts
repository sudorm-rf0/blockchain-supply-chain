import { TRADE_API_URL } from "./env";
import { request } from "./http";
import type { CreateTradeRequest, CreateTradeResponse, TradeRecord, BuiltTransactionResponse } from "./types";

export { CreateTradeRequest, CreateTradeResponse, TradeRecord, BuiltTransactionResponse };

export async function createTrade(
  requestBody: CreateTradeRequest,
): Promise<CreateTradeResponse> {
  return request(`${TRADE_API_URL}/api/trades`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
}

export async function confirmTrade(
  tradeId: string,
  body: {
    buyerWallet: string;
    sellerWallet: string;
    amount: string;
    tenor: string;
    txSignature: string;
  },
): Promise<{ ok: boolean; tradeId: string; dealPda: string; status: string }> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchMyTrades(): Promise<TradeRecord[]> {
  return request(`${TRADE_API_URL}/api/trades`, { cache: "no-store" });
}

export async function fetchTrade(tradeId: string): Promise<TradeRecord> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}`, { cache: "no-store" });
}

export async function fetchAllTrades(): Promise<TradeRecord[]> {
  return request(`${TRADE_API_URL}/api/trades/admin`, { cache: "no-store" });
}

export async function buildFundTrade(
  tradeId: string,
  adminWallet: string,
): Promise<BuiltTransactionResponse> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/fund`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminWallet }),
  });
}

export async function confirmFundTrade(
  tradeId: string,
  txSignature: string,
): Promise<{ ok: boolean; tradeId: string; status: string }> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/fund/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txSignature, confirm: true }),
  });
}

export async function buildAdvanceTrade(
  tradeId: string,
  targetStatus: number,
  adminWallet: string,
): Promise<BuiltTransactionResponse> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targetStatus: String(targetStatus), adminWallet }),
  });
}

export async function confirmAdvanceTrade(
  tradeId: string,
  targetStatus: number,
  adminWallet: string,
  txSignature: string,
): Promise<{ ok: boolean; tradeId: string; status: string }> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/advance/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      targetStatus: String(targetStatus),
      adminWallet,
      txSignature,
    }),
  });
}

export async function buildRepayTrade(
  tradeId: string,
): Promise<BuiltTransactionResponse> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/repay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function confirmRepayTrade(
  tradeId: string,
  txSignature: string,
): Promise<{ ok: boolean; tradeId: string; status: string }> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/repay/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txSignature, confirm: true }),
  });
}

export async function buildDefaultTrade(
  tradeId: string,
  adminWallet: string,
): Promise<BuiltTransactionResponse> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/default`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminWallet }),
  });
}

export async function confirmDefaultTrade(
  tradeId: string,
  txSignature: string,
): Promise<{ ok: boolean; tradeId: string; status: string }> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/default/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txSignature, confirm: true }),
  });
}

export async function buildReleaseTrade(
  tradeId: string,
  adminWallet: string,
): Promise<BuiltTransactionResponse> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminWallet }),
  });
}

export async function confirmReleaseTrade(
  tradeId: string,
  txSignature: string,
): Promise<{ ok: boolean; tradeId: string; status: string }> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/release/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txSignature, confirm: true }),
  });
}
