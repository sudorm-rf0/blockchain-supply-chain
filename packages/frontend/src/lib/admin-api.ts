import { BACKEND_URL } from "./env";
import { request } from "./http";
import type { AuditLogRecord, AuditLogsResponse } from "./types";

export { AuditLogRecord, AuditLogsResponse };

export async function fetchAuditLogs(params: {
  page: number;
  limit: number;
  action?: string;
  targetType?: string;
  actorEmail?: string;
  keyword?: string;
  from?: string;
  to?: string;
}): Promise<AuditLogsResponse> {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  if (params.action) query.set("action", params.action);
  if (params.targetType) query.set("targetType", params.targetType);
  if (params.actorEmail) query.set("actorEmail", params.actorEmail);
  if (params.keyword) query.set("keyword", params.keyword);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  return request(`${BACKEND_URL}/api/admin/audit-logs?${query.toString()}`);
}

export async function exportAuditLogs(params: {
  action?: string;
  targetType?: string;
  actorEmail?: string;
  keyword?: string;
  from?: string;
  to?: string;
}): Promise<Blob> {
  const query = new URLSearchParams();
  if (params.action) query.set("action", params.action);
  if (params.targetType) query.set("targetType", params.targetType);
  if (params.actorEmail) query.set("actorEmail", params.actorEmail);
  if (params.keyword) query.set("keyword", params.keyword);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  const resp = await fetch(
    `${BACKEND_URL}/api/admin/audit-logs/export?${query.toString()}`,
    { credentials: "include" },
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || "export failed");
  }
  return resp.blob();
}
