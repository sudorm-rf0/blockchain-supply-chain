const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const TRADE_API_URL =
  process.env.NEXT_PUBLIC_TRADE_API_URL ?? "http://localhost:3004";
const POOL_API_URL =
  process.env.NEXT_PUBLIC_POOL_API_URL ?? "http://localhost:3005";

import { useUserStore } from "@/stores/user-store";

export type UserRole = "USER" | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export type FileStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface FileRecord {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  path: string;
  hash: string;
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
  const token = useUserStore.getState().token;
  if (token) {
    headers["authorization"] = `Bearer ${token}`;
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
  walletAddress: string,
): Promise<CreateTradeResponse> {
  return request(`${TRADE_API_URL}/api/trades`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-wallet-address": walletAddress,
    },
    body: JSON.stringify(requestBody),
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

export function formatUsdc(raw: string | number): string {
  return (Number(raw) / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
