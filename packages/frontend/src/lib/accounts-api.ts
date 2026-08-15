import { BACKEND_URL } from "./env";
import { request } from "./http";

export type AccountRole = "USER" | "ADMIN" | "SUPER_ADMIN";

export interface AccountRecord {
  id: string;
  email: string;
  name: string;
  role: AccountRole;
  wallet: string;
  emailVerified: boolean;
  emailOtpEnabled: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastPasswordChangeAt: string | null;
  inviteCode: { code: string } | null;
  _count?: { files: number; buyerDeals: number; sellerDeals: number };
}

export interface InviteCodeRecord {
  id: string;
  code: string;
  usedAt: string | null;
  usedByEmail: string | null;
  usedByName: string | null;
  usedByRole: string | null;
  createdAt: string;
}

export interface AccountsResponse {
  items: AccountRecord[];
  total: number;
  page: number;
  limit: number;
}

export async function listAccounts(params: {
  page?: number;
  limit?: number;
  q?: string;
  role?: string;
}): Promise<AccountsResponse> {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.limit) search.set("limit", String(params.limit));
  if (params.q) search.set("q", params.q);
  if (params.role) search.set("role", params.role);
  const qs = search.toString();
  return request(
    `${BACKEND_URL}/api/admin/accounts${qs ? `?${qs}` : ""}`,
  );
}

export interface AccountFile {
  id: string;
  filename: string;
  status: string;
  size: number;
  createdAt: string;
  txSignature: string | null;
}

export interface AccountDeal {
  id: string;
  dealId: string;
  status: string;
  amount: string;
  createdAt: string;
}

export interface AccountDetail extends AccountRecord {
  files: AccountFile[];
  buyerDeals: AccountDeal[];
  sellerDeals: AccountDeal[];
}

export async function getAccount(id: string): Promise<AccountDetail> {
  return request(`${BACKEND_URL}/api/admin/accounts/${id}`);
}

export async function createAccount(input: {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "SUPER_ADMIN";
}): Promise<{ id: string; email: string; name: string; role: AccountRole }> {
  return request(`${BACKEND_URL}/api/admin/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function changeAccountRole(
  id: string,
  role: AccountRole,
): Promise<{ id: string; email: string; name: string; role: AccountRole }> {
  return request(`${BACKEND_URL}/api/admin/accounts/${id}/role`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

export async function generateInviteCodes(
  count: number,
): Promise<{ ok: boolean; count: number; codes: string[] }> {
  return request(`${BACKEND_URL}/api/admin/invite-codes/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ count }),
  });
}

export async function fetchInviteCodes(): Promise<{
  items: InviteCodeRecord[];
}> {
  return request(`${BACKEND_URL}/api/admin/invite-codes`);
}

/** 导出邀请码清单（纯文本，含 Bearer 认证），由前端触发下载。 */
export async function fetchInviteCodesExport(): Promise<string> {
  return request(`${BACKEND_URL}/api/admin/invite-codes/export`, {
    headers: { accept: "text/plain" },
  });
}

export interface InviteStats {
  total: number;
  used: number;
  unused: number;
  usageRate: number;
  byRole: Record<string, number>;
  trend: Array<{ date: string; generated: number; used: number }>;
  byCreator: Array<{
    userId: string;
    email: string | null;
    name: string | null;
    generated: number;
    used: number;
    usageRate: number;
  }>;
  recentUsed: Array<{
    id: string;
    code: string;
    usedAt: string | null;
    usedByEmail: string | null;
    usedByName: string | null;
    usedByRole: string | null;
  }>;
}

export async function fetchInviteStats(): Promise<InviteStats> {
  return request(`${BACKEND_URL}/api/admin/invite-codes/stats`);
}
