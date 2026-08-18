import { request } from "@/lib/http";
import { BACKEND_URL } from "@/lib/env";

export interface VisitSummary {
  ranges: {
    today: { visits: number; uniqueIps: number; loggedInVisits: number; label: string };
    "24h": { visits: number; uniqueIps: number; loggedInVisits: number; label: string };
    "7d": { visits: number; uniqueIps: number; loggedInVisits: number; label: string };
  };
  topPages: Array<{ path: string; count: number }>;
  topIps: Array<{ ip: string; count: number }>;
  errors: Array<{ statusCode: number; count: number }>;
  slow: Array<{ path: string; avgMs: number; count: number }>;
}

export interface VisitItem {
  id: string;
  ip: string | null;
  userAgent: string | null;
  path: string;
  method: string;
  statusCode: number;
  referrer: string | null;
  userId: string | null;
  durationMs: number;
  createdAt: string;
}

export interface VisitList {
  items: VisitItem[];
  total: number;
  page: number;
  limit: number;
}

export interface WebmasterInfo {
  server: {
    hostname: string;
    uptime: string;
    uptimeSeconds: number;
    platform: string;
    node: string;
    cpus: number;
    loadavg: number[];
    memoryMb: { total: number; free: number; used: number };
  };
  site: {
    users: number;
    files: number;
    deals: number;
    financing: number;
    pendingFiles: number;
    audits24h: number;
    errors24h: number;
  };
}

export function fetchOwnerSummary(): Promise<VisitSummary> {
  return request(`${BACKEND_URL}/api/admin/owner/summary`);
}

export function fetchOwnerVisits(params: {
  page?: number;
  limit?: number;
  ip?: string;
  path?: string;
}): Promise<VisitList> {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.limit) q.set("limit", String(params.limit));
  if (params.ip) q.set("ip", params.ip);
  if (params.path) q.set("path", params.path);
  return request(`${BACKEND_URL}/api/admin/owner/visits?${q.toString()}`);
}

export function fetchWebmasterInfo(): Promise<WebmasterInfo> {
  return request(`${BACKEND_URL}/api/admin/owner/webmaster`);
}
