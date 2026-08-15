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
