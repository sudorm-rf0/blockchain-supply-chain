import { BACKEND_URL } from "./env";
import { request } from "./http";
import type { AuditLogRecord, AuditLogsResponse } from "./types";

export { AuditLogRecord, AuditLogsResponse };

export async function fetchAuditLogs(params: {
  page: number;
  limit: number;
  action?: string;
  targetType?: string;
}): Promise<AuditLogsResponse> {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  if (params.action) query.set("action", params.action);
  if (params.targetType) query.set("targetType", params.targetType);
  return request(`${BACKEND_URL}/api/admin/audit-logs?${query.toString()}`);
}
