import { request } from "@/lib/http";
import { BACKEND_URL } from "@/lib/env";

export interface FinancingRecord {
  id: string;
  invoiceId: string;
  invoiceFilename: string | null;
  invoiceHash: string | null;
  applicantName?: string | null;
  applicantEmail?: string | null;
  invoiceAmount: string;
  amount: string;
  discountRate: number;
  tenorDays: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "REPAID";
  reviewedAt: string | null;
  repaidAt: string | null;
  createdAt: string;
}

export async function applyFinancing(input: {
  invoiceId: string;
  invoiceAmount: string;
  amount: string;
  discountRate?: number;
  tenorDays: number;
  turnstileToken?: string;
}): Promise<FinancingRecord> {
  return request(`${BACKEND_URL}/api/financing/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function fetchMyFinancing(): Promise<{ items: FinancingRecord[] }> {
  return request(`${BACKEND_URL}/api/financing/mine`);
}

export async function fetchAdminFinancing(): Promise<{ items: FinancingRecord[] }> {
  return request(`${BACKEND_URL}/api/financing/admin`);
}

export async function reviewFinancing(
  id: string,
  action: "approve" | "reject",
  txSignature?: string,
): Promise<FinancingRecord> {
  return request(`${BACKEND_URL}/api/financing/${id}/${action}`, {
    method: "POST",
    body: JSON.stringify(action === "approve" ? { txSignature } : {}),
  });
}

/** 审计 H-4：还款必须携带链上 USDC 转账签名（申请人→平台），否则后端拒绝。 */
export async function repayFinancing(id: string, txSignature: string): Promise<FinancingRecord> {
  return request(`${BACKEND_URL}/api/financing/${id}/repay`, {
    method: "POST",
    body: JSON.stringify({ txSignature }),
  });
}
