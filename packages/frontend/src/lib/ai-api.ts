import { BACKEND_URL } from "./env";
import { request } from "./http";

export interface AiChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiSessionMeta {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

export interface AiSession {
  id: string;
  title: string;
  messages: AiChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export async function aiChat(
  message: string,
  history?: AiChatMessage[],
  sessionId?: string,
): Promise<{ reply: string; sessionId: string }> {
  return request(`${BACKEND_URL}/api/ai/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, history: history ?? [], sessionId }),
  });
}

export async function fetchAiHistory(): Promise<AiSessionMeta[]> {
  return request(`${BACKEND_URL}/api/ai/history`, { cache: "no-store" });
}

export async function fetchAiSession(sessionId: string): Promise<AiSession> {
  return request(`${BACKEND_URL}/api/ai/history/${sessionId}`, {
    cache: "no-store",
  });
}

export async function deleteAiHistory(sessionId?: string): Promise<{ ok: boolean; deleted: number }> {
  const url = sessionId
    ? `${BACKEND_URL}/api/ai/history/${sessionId}`
    : `${BACKEND_URL}/api/ai/history`;
  return request(url, { method: "DELETE" });
}

export interface AiStats {
  total30d: number;
  last24h: number;
  last7d: number;
  byAction: Record<string, number>;
  byModel: Record<string, number>;
  byDay: Array<{ date: string; count: number }>;
  recent: Array<{
    actorEmail: string | null;
    action: string;
    model: string;
    question: string;
    createdAt: string;
  }>;
}

export async function fetchAiStats(): Promise<AiStats> {
  return request(`${BACKEND_URL}/api/admin/ai-stats`, { cache: "no-store" });
}
