const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const TRADE_API_URL =
  process.env.NEXT_PUBLIC_TRADE_API_URL ?? "http://localhost:3004";
const POOL_API_URL =
  process.env.NEXT_PUBLIC_POOL_API_URL ?? "http://localhost:3005";
const INDEXER_API_URL =
  process.env.NEXT_PUBLIC_INDEXER_API_URL ?? "http://localhost:3003";

import { useUserStore } from "@/stores/user-store";

export type UserRole = "USER" | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  wallet?: string;
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

function authHeaders(): Record<string, string> {
  const token = useUserStore.getState().token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = authHeaders();
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
      headers[k] = v;
    }
  }
  if (!headers["content-type"] && !(init?.body instanceof FormData)) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as T;
}

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: AuthUser }> {
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
}): Promise<{ token: string; user: AuthUser }> {
  return request(`${BACKEND_URL}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getMe(): Promise<AuthUser> {
  return request(`${BACKEND_URL}/api/auth/me`);
}

export async function uploadFile(
  formData: FormData,
): Promise<FileRecord> {
  return request(`${BACKEND_URL}/api/files`, {
    method: "POST",
    body: formData,
  });
}

export async function getFiles(params: {
  page: number;
  limit: number;
  status?: string;
}): Promise<FilesResponse> {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  if (params.status) query.set("status", params.status);
  return request(`${BACKEND_URL}/api/files?${query.toString()}`);
}

export async function getFile(id: string): Promise<FileRecord> {
  return request(`${BACKEND_URL}/api/files/${id}`);
}

export async function fetchFileBlob(id: string): Promise<Blob> {
  const response = await fetch(`${BACKEND_URL}/api/files/${id}/content`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.blob();
}

export async function deleteFile(id: string): Promise<{ ok: boolean }> {
  return request(`${BACKEND_URL}/api/files/${id}`, { method: "DELETE" });
}

export async function reviewFile(
  id: string,
  body: { status: "APPROVED" | "REJECTED"; remark?: string },
): Promise<FileRecord> {
  return request(`${BACKEND_URL}/api/files/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
  body: { txSignature: string; documentPda: string },
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
    body: JSON.stringify({ txSignature }),
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
    body: JSON.stringify({ txSignature }),
  });
}

export interface PoolTrendPoint {
  capturedAt: string;
  nav: string;
  totalAssets: string;
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
