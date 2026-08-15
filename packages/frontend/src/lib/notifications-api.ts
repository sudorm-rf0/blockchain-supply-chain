import { BACKEND_URL } from "./env";
import { request } from "./http";

export interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  items: NotificationRecord[];
  total: number;
  page: number;
  limit: number;
  unread: number;
}

export async function fetchNotifications(page = 1, limit = 20): Promise<NotificationsResponse> {
  return request(`${BACKEND_URL}/api/notifications?page=${page}&limit=${limit}`);
}

export async function fetchUnreadCount(): Promise<number> {
  return request(`${BACKEND_URL}/api/notifications/unread-count`);
}

export async function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  return request(`${BACKEND_URL}/api/notifications/${id}/read`, { method: "POST" });
}

export async function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  return request(`${BACKEND_URL}/api/notifications/read-all`, { method: "POST" });
}
