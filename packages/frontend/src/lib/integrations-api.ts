import { BACKEND_URL } from "./env";
import { request } from "./http";

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  role: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface WebhookRecord {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  lastSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchApiKeys(): Promise<{ items: ApiKeyRecord[] }> {
  return request(`${BACKEND_URL}/api/admin/integrations/api-keys`);
}

export async function createApiKey(input: { name: string; role?: string }): Promise<{ id: string; name: string; prefix: string; role: string; key: string }> {
  return request(`${BACKEND_URL}/api/admin/integrations/api-keys`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function revokeApiKey(id: string): Promise<{ ok: boolean }> {
  return request(`${BACKEND_URL}/api/admin/integrations/api-keys/${id}`, { method: "DELETE" });
}

export async function fetchWebhooks(): Promise<{ items: WebhookRecord[] }> {
  return request(`${BACKEND_URL}/api/admin/integrations/webhooks`);
}

export async function createWebhook(input: { name: string; url: string; events: string[]; active?: boolean }): Promise<{ id: string; name: string; url: string; secret: string }> {
  return request(`${BACKEND_URL}/api/admin/integrations/webhooks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateWebhook(id: string, input: { name?: string; url?: string; events?: string[]; active?: boolean }): Promise<{ id: string; name: string; url: string; active: boolean }> {
  return request(`${BACKEND_URL}/api/admin/integrations/webhooks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteWebhook(id: string): Promise<{ ok: boolean }> {
  return request(`${BACKEND_URL}/api/admin/integrations/webhooks/${id}`, { method: "DELETE" });
}

export async function testWebhook(id: string): Promise<{ ok: boolean; status: number; message: string }> {
  return request(`${BACKEND_URL}/api/admin/integrations/webhooks/${id}/test`, { method: "POST" });
}
