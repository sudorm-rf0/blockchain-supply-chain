import { BACKEND_URL } from "./env";
import { request } from "./http";

export interface ReportSummary {
  total: number;
  amountTotal?: string;
  downPaymentTotal?: string;
  invoiceAmountTotal?: string;
  byStatus?: Record<string, number>;
  byAction?: Record<string, number>;
}

export interface ReportItem {
  id: string;
  [key: string]: string | number | null | undefined;
}

export interface ReportResponse {
  summary: ReportSummary;
  items: ReportItem[];
}

export async function fetchOrdersReport(params: { from?: string; to?: string; status?: string }): Promise<ReportResponse> {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.status) q.set("status", params.status);
  return request(`${BACKEND_URL}/api/admin/reports/orders?${q.toString()}`);
}

export async function fetchFinancingReport(params: { from?: string; to?: string; status?: string }): Promise<ReportResponse> {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.status) q.set("status", params.status);
  return request(`${BACKEND_URL}/api/admin/reports/financing?${q.toString()}`);
}

export async function fetchAuditReport(params: { from?: string; to?: string; action?: string }): Promise<ReportResponse> {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.action) q.set("action", params.action);
  return request(`${BACKEND_URL}/api/admin/reports/audit?${q.toString()}`);
}

function exportUrl(base: string, params: { from?: string; to?: string }): string {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  return `${BACKEND_URL}${base}?${q.toString()}`;
}

export function ordersExportUrl(params: { from?: string; to?: string }): string {
  return exportUrl("/api/admin/reports/orders/export", params);
}
export function financingExportUrl(params: { from?: string; to?: string }): string {
  return exportUrl("/api/admin/reports/financing/export", params);
}
export function auditExportUrl(params: { from?: string; to?: string }): string {
  return exportUrl("/api/admin/reports/audit/export", params);
}
