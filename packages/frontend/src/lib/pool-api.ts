import { POOL_API_URL } from "./env";
import { request } from "./http";
import type { PoolOverview, WithdrawRequestRecord, BuiltTransactionResponse } from "./types";

export { PoolOverview, WithdrawRequestRecord };

export async function fetchPoolOverview(): Promise<PoolOverview> {
  return request(`${POOL_API_URL}/api/pool/overview`, { cache: "no-store" });
}

export async function buildRedeemLp(
  lpWallet: string,
  lpAmount: string,
): Promise<BuiltTransactionResponse> {
  return request(`${POOL_API_URL}/api/lp/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lpWallet, lpAmount }),
  });
}

export async function confirmRedeemLp(
  lpAmount: string,
  txSignature: string,
): Promise<{ ok: boolean; id: string; status: string }> {
  return request(`${POOL_API_URL}/api/lp/redeem/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lpAmount, txSignature }),
  });
}

export async function fetchWithdrawRequests(): Promise<WithdrawRequestRecord[]> {
  return request(`${POOL_API_URL}/api/lp/withdraw-requests`, {
    cache: "no-store",
  });
}

export async function executeWithdrawal(
  id: string,
  txSignature?: string,
): Promise<{ ok: boolean; id: string; status: string }> {
  return request(`${POOL_API_URL}/api/lp/withdraw-request/${id}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txSignature, confirm: true }),
  });
}
