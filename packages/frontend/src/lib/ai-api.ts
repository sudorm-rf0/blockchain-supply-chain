import { BACKEND_URL } from "./env";
import { request } from "./http";

export interface AiChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function aiChat(
  message: string,
  history?: AiChatMessage[],
): Promise<{ reply: string }> {
  return request(`${BACKEND_URL}/api/ai/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, history: history ?? [] }),
  });
}
