import { BACKEND_URL } from "./env";
import { request } from "./http";

export async function submitFeedback(body: {
  content: string;
  contact?: string;
}): Promise<{ ok: boolean }> {
  return request(`${BACKEND_URL}/api/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface FeedbackItem {
  id: string;
  userId: string | null;
  userEmail: string | null;
  contact: string | null;
  content: string;
  status: string;
  processedAt: string | null;
  createdAt: string;
}

export async function fetchFeedbackList(status?: string): Promise<FeedbackItem[]> {
  const qs = status && status !== "ALL" ? `?status=${encodeURIComponent(status)}` : "";
  return request(`${BACKEND_URL}/api/admin/feedback${qs}`, { cache: "no-store" });
}

export async function processFeedback(
  id: string,
): Promise<{ ok: boolean; id: string; status: string; processedAt: string | null }> {
  return request(`${BACKEND_URL}/api/admin/feedback/${id}/process`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}
