const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const TRADE_API_URL =
  process.env.NEXT_PUBLIC_TRADE_API_URL ?? "http://localhost:3004";
const POOL_API_URL =
  process.env.NEXT_PUBLIC_POOL_API_URL ?? "http://localhost:3005";
const INDEXER_API_URL =
  process.env.NEXT_PUBLIC_INDEXER_API_URL ?? "http://localhost:3003";

import { useUserStore } from "@/stores/user-store";

type UserRole = "USER" | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  wallet?: string;
  mustChangePassword?: boolean;
}

export type FileStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface FileRecord {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  path: string;
  hash: string;
  txSignature?: string | null;
  documentPda?: string | null;
  attestedAt?: string | null;
  status: FileStatus;
  tradeId?: string | null;
  documentGroupId?: string | null;
  version?: number;
  supersededAt?: string | null;
  isLatest?: boolean;
  description?: string | null;
  remark?: string | null;
  uploaderName?: string | null;
  createdAt: string;
}

export interface FilesResponse {
  items: FileRecord[];
  total: number;
  page: number;
  limit: number;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { message?: string | string[] };
    return Array.isArray(body.message)
      ? body.message.join(", ")
      : body.message ?? text;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

const API_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS ?? 15000);

let refreshPromise: Promise<boolean> | null = null;

function isAuthEndpoint(url: string): boolean {
  return (
    url.includes("/api/auth/login") ||
    url.includes("/api/auth/register") ||
    url.includes("/api/auth/refresh")
  );
}

function forceLogout(): void {
  useUserStore.getState().logout();
  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

async function tryRefreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetchWithTimeout(
          `${BACKEND_URL}/api/auth/refresh`,
          {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
          },
          API_TIMEOUT_MS,
        );
        if (!response.ok) return false;
        const body = (await response.json()) as {
          user: AuthUser;
          mustChangePassword?: boolean;
        };
        useUserStore.getState().setAuth({
          ...body.user,
          mustChangePassword:
            body.mustChangePassword ??
            body.user.mustChangePassword ??
            false,
        });
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => {
          refreshPromise = null;
        }, 300);
      }
    })();
  }
  return refreshPromise;
}

function isRetryable(error: unknown, method: string): boolean {
  if (method !== "GET" || !(error instanceof Error)) return false;
  return (
    error.name === "AbortError" ||
    error.message.includes("Failed to fetch") ||
    /^HTTP 5\d\d/.test(error.message)
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requestWithRetry(
  url: string,
  init: RequestInit,
  headers: Record<string, string>,
  allowRefresh = true,
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const maxAttempts = method === "GET" ? 3 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        url,
        { ...init, credentials: "include", headers },
        API_TIMEOUT_MS,
      );
      if (
        response.status === 401 &&
        allowRefresh &&
        !isAuthEndpoint(url)
      ) {
        const refreshed = await tryRefreshSession();
        if (refreshed) {
          const retry = await fetchWithTimeout(
            url,
            { ...init, credentials: "include", headers },
            API_TIMEOUT_MS,
          );
          if (retry.status === 401) {
            forceLogout();
            throw new Error("登录已过期，请重新登录");
          }
          if (!retry.ok) {
            const message = await readError(retry);
            throw new Error(`HTTP ${retry.status}: ${message}`);
          }
          return retry;
        }
        forceLogout();
        throw new Error("登录已过期，请重新登录");
      }
      if (!response.ok) {
        const message = await readError(response);
        throw new Error(`HTTP ${response.status}: ${message}`);
      }
      return response;
    } catch (error) {
      if (attempt < maxAttempts && isRetryable(error, method)) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 300));
        continue;
      }
      throw error;
    }
  }
  throw new Error("request failed");
}

async function request<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
      headers[k] = v;
    }
  }
  if (!headers["content-type"] && !(init?.body instanceof FormData)) {
    headers["content-type"] = "application/json";
  }
  const response = await requestWithRetry(url, init ?? {}, headers);
  return (await response.json()) as T;
}

export async function login(
  email: string,
  password: string,
): Promise<{ accessToken?: string; user: AuthUser; mustChangePassword?: boolean }> {
  return request(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
  wallet?: string;
}): Promise<{ accessToken?: string; user: AuthUser; mustChangePassword?: boolean }> {
  return request(`${BACKEND_URL}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getMe(): Promise<{
  user: AuthUser;
  mustChangePassword: boolean;
}> {
  return request(`${BACKEND_URL}/api/auth/me`);
}

export async function fetchSession(): Promise<AuthUser | null> {
  try {
    const { user, mustChangePassword } = await getMe();
    const hydrated = {
      ...user,
      mustChangePassword:
        mustChangePassword ?? user.mustChangePassword ?? false,
    };
    useUserStore.getState().setAuth(hydrated);
    return hydrated;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await request(`${BACKEND_URL}/api/auth/logout`, { method: "POST" });
  } catch {
    // 即使服务端会话已过期也继续清理本地状态。
  }
  useUserStore.getState().logout();
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; user: AuthUser; mustChangePassword: boolean }> {
  return request(`${BACKEND_URL}/api/auth/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function uploadFile(
  formData: FormData,
): Promise<FileRecord> {
  return request(`${BACKEND_URL}/api/files`, {
    method: "POST",
    body: formData,
  });
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadFields {
  tradeId?: string;
  documentId?: string;
  description?: string;
}

/** XHR 上传并回报进度，兼容 50MB 大文件与 httpOnly Cookie 认证。 */
export function uploadFileWithProgress(
  file: File,
  fields: UploadFields,
  onProgress: (progress: UploadProgress) => void,
): Promise<FileRecord> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    if (fields.tradeId) form.append("tradeId", fields.tradeId);
    if (fields.documentId) form.append("documentId", fields.documentId);
    if (fields.description) form.append("description", fields.description);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BACKEND_URL}/api/files`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100),
        });
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as FileRecord);
        } catch {
          reject(new Error("上传响应解析失败"));
        }
        return;
      }
      let message = `HTTP ${xhr.status}`;
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string | string[] };
        message = Array.isArray(body.message)
          ? body.message.join(", ")
          : body.message ?? message;
      } catch {
        // 保留 HTTP 状态作为错误信息。
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("网络错误，上传失败"));
    xhr.send(form);
  });
}

export async function getFiles(params: {
  page: number;
  limit: number;
  status?: string;
  tradeId?: string;
}): Promise<FilesResponse> {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  if (params.status) query.set("status", params.status);
  if (params.tradeId) query.set("tradeId", params.tradeId);
  return request(`${BACKEND_URL}/api/files?${query.toString()}`);
}

export async function getFile(id: string): Promise<FileRecord> {
  return request(`${BACKEND_URL}/api/files/${id}`);
}

export async function fetchFileVersions(
  id: string,
): Promise<FileRecord[]> {
  return request(`${BACKEND_URL}/api/files/${id}/versions`);
}

export async function fetchFileBlob(id: string): Promise<Blob> {
  const response = await requestWithRetry(
    `${BACKEND_URL}/api/files/${id}/content`,
    {},
    {},
  );
  return response.blob();
}

export async function deleteFile(id: string): Promise<{ ok: boolean }> {
  return request(`${BACKEND_URL}/api/files/${id}?confirm=true`, {
    method: "DELETE",
  });
}

export async function reviewFile(
  id: string,
  body: { status: "APPROVED" | "REJECTED"; remark?: string },
): Promise<FileRecord> {
  return request(`${BACKEND_URL}/api/files/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, confirm: true }),
  });
}

export interface AuditLogRecord {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogsResponse {
  items: AuditLogRecord[];
  total: number;
  page: number;
  limit: number;
}

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

export interface AttestDocumentResponse {
  transaction: string;
  blockhash: string;
  documentPda: string;
  message: string;
}

export async function buildDocumentAttest(
  fileId: string,
  body: { walletAddress: string; tradeId?: string },
): Promise<AttestDocumentResponse> {
  return request(`${BACKEND_URL}/api/files/${fileId}/attest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function confirmDocumentAttest(
  fileId: string,
  body: { txSignature: string; documentPda: string; tradeId?: string },
): Promise<{
  ok: boolean;
  txSignature: string | null;
  documentPda: string | null;
  attestedAt: string | null;
}> {
  return request(`${BACKEND_URL}/api/files/${fileId}/attest/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface CreateTradeRequest {
  buyerWallet: string;
  sellerWallet: string;
  amount: string;
  tenor: string;
  logisticsHash?: string | null;
}

export interface CreateTradeResponse {
  tradeId: string;
  transaction: string;
  blockhash: string;
  dealPda: string;
  downPayment: string;
  poolPortion: string;
}

export async function createTrade(
  requestBody: CreateTradeRequest,
): Promise<CreateTradeResponse> {
  return request(`${TRADE_API_URL}/api/trades`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
}

export interface TradeRecord {
  id: string;
  tradeId: string;
  buyerWallet: string;
  sellerWallet: string;
  amount: string;
  downPayment: string;
  poolPortion: string;
  tenor: number;
  status: string;
  txSignature?: string | null;
  logisticsHash?: string | null;
  createdAt: string;
}

export async function confirmTrade(
  tradeId: string,
  body: {
    buyerWallet: string;
    sellerWallet: string;
    amount: string;
    tenor: string;
    txSignature: string;
  },
): Promise<{
  ok: boolean;
  tradeId: string;
  dealPda: string;
  status: string;
}> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchMyTrades(): Promise<TradeRecord[]> {
  return request(`${TRADE_API_URL}/api/trades`, { cache: "no-store" });
}

export async function fetchTrade(tradeId: string): Promise<TradeRecord> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}`, {
    cache: "no-store",
  });
}

export interface BuiltTransactionResponse {
  tradeId: string;
  transaction: string;
  blockhash: string;
  message: string;
  targetStatus?: number;
}

export async function buildFundTrade(
  tradeId: string,
  adminWallet: string,
): Promise<BuiltTransactionResponse> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/fund`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminWallet }),
  });
}

export async function confirmFundTrade(
  tradeId: string,
  txSignature: string,
): Promise<{ ok: boolean; tradeId: string; status: string }> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/fund/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txSignature, confirm: true }),
  });
}

export async function buildAdvanceTrade(
  tradeId: string,
  targetStatus: number,
  adminWallet: string,
): Promise<BuiltTransactionResponse> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targetStatus: String(targetStatus), adminWallet }),
  });
}

export async function confirmAdvanceTrade(
  tradeId: string,
  targetStatus: number,
  adminWallet: string,
  txSignature: string,
): Promise<{ ok: boolean; tradeId: string; status: string }> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/advance/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      targetStatus: String(targetStatus),
      adminWallet,
      txSignature,
    }),
  });
}

export async function buildRepayTrade(
  tradeId: string,
): Promise<BuiltTransactionResponse> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/repay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function confirmRepayTrade(
  tradeId: string,
  txSignature: string,
): Promise<{ ok: boolean; tradeId: string; status: string }> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/repay/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txSignature, confirm: true }),
  });
}

export async function buildDefaultTrade(
  tradeId: string,
  adminWallet: string,
): Promise<BuiltTransactionResponse> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/default`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminWallet }),
  });
}

export async function confirmDefaultTrade(
  tradeId: string,
  txSignature: string,
): Promise<{ ok: boolean; tradeId: string; status: string }> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/default/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txSignature, confirm: true }),
  });
}

export async function buildReleaseTrade(
  tradeId: string,
  adminWallet: string,
): Promise<BuiltTransactionResponse> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminWallet }),
  });
}

export async function confirmReleaseTrade(
  tradeId: string,
  txSignature: string,
): Promise<{ ok: boolean; tradeId: string; status: string }> {
  return request(`${TRADE_API_URL}/api/trades/${tradeId}/release/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txSignature, confirm: true }),
  });
}

export interface PoolTrendPoint {
  capturedAt: string;
  nav: string;
  totalAssets: string;
  activeCapital: string;
  idle: string;
  utilizationBps: number;
}

export interface PoolOverview {
  poolAddress: string;
  nav: string;
  totalAssets: string;
  activeCapital: string;
  reserveFund: string;
  insuranceFund: string;
  pendingDividends: string;
  utilizationBps: number;
  aprPct: number;
  downPaymentSharePct: number;
  poolPortionSharePct: number;
  totalDeals: number;
  activeDeals: number;
  settledDeals: number;
  defaultedDeals: number;
  outstandingAmount: string;
  trend: PoolTrendPoint[];
}

export async function fetchPoolOverview(): Promise<PoolOverview> {
  return request(`${POOL_API_URL}/api/pool/overview`, { cache: "no-store" });
}

export async function buildRedeemLp(
  lpWallet: string,
  lpAmount: string,
): Promise<BuiltTransactionResponse> {
  return request(`${POOL_API_URL}/api/lp/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lpWallet, lpAmount }),
  });
}

export async function confirmRedeemLp(
  lpAmount: string,
  txSignature: string,
): Promise<{ ok: boolean; id: string; status: string }> {
  return request(`${POOL_API_URL}/api/lp/redeem/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lpAmount, txSignature }),
  });
}

export async function fetchAllTrades(): Promise<TradeRecord[]> {
  return request(`${TRADE_API_URL}/api/trades/admin`, { cache: "no-store" });
}

export interface WithdrawRequestRecord {
  id: string;
  lpAddress: string;
  amount: string;
  requestedAt: string;
  availableAt: string;
  status: string;
}

export async function fetchWithdrawRequests(): Promise<WithdrawRequestRecord[]> {
  return request(`${POOL_API_URL}/api/lp/withdraw-requests`, {
    cache: "no-store",
  });
}

export async function executeWithdrawal(
  id: string,
  txSignature?: string,
): Promise<{ ok: boolean; id: string; status: string }> {
  return request(`${POOL_API_URL}/api/lp/withdraw-request/${id}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txSignature, confirm: true }),
  });
}

export interface IndexerStatus {
  service: string;
  queue: {
    wait: number;
    active: number;
    delayed: number;
    failed: number;
  };
  lastPoolSnapshotAt: string | null;
  lastDealSyncedAt: string | null;
  totalDeals: number;
  now: string;
}

export async function fetchIndexerStatus(): Promise<IndexerStatus> {
  return request(`${INDEXER_API_URL}/api/indexer/status`, {
    cache: "no-store",
  });
}

export function formatUsdc(raw: string | number): string {
  return (Number(raw) / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
