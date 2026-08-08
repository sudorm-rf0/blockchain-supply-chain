import { BACKEND_URL } from "./env";
import { request } from "./http";

export interface RegistryStatus {
  initialized: boolean;
  registry: string;
  admin: string | null;
  initializedAt: number | null;
}

export interface SupplierRecord {
  address: string;
  pda: string;
  authorizedAt: string;
  createdAt: string;
}

export interface ProductRecord {
  owner: string;
  sku: string;
  units: string;
  pda: string;
  txSignature: string | null;
  createdAt: string;
}

export interface BuiltTransactionResponse {
  transaction: string;
  blockhash: string;
}

export async function fetchRegistry(): Promise<RegistryStatus> {
  return request(`${BACKEND_URL}/api/supply-chain/registry`, {
    cache: "no-store",
  });
}

export async function initRegistry(body: {
  adminWallet: string;
}): Promise<BuiltTransactionResponse & { registry: string }> {
  return request(`${BACKEND_URL}/api/supply-chain/registry/init`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function confirmInitRegistry(body: {
  adminWallet: string;
  txSignature: string;
}): Promise<{ ok: boolean; admin: string; registry: string }> {
  return request(`${BACKEND_URL}/api/supply-chain/registry/init/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchSuppliers(): Promise<SupplierRecord[]> {
  return request(`${BACKEND_URL}/api/supply-chain/suppliers`, {
    cache: "no-store",
  });
}

export async function authorizeSupplier(body: {
  adminWallet: string;
  supplier: string;
}): Promise<BuiltTransactionResponse & { supplier: string; supplierPda: string }> {
  return request(`${BACKEND_URL}/api/supply-chain/suppliers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function confirmAuthorizeSupplier(body: {
  supplier: string;
  txSignature: string;
}): Promise<{ ok: boolean; supplier: string; pda: string }> {
  return request(`${BACKEND_URL}/api/supply-chain/suppliers/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function revokeSupplier(
  address: string,
  body: { adminWallet: string },
): Promise<BuiltTransactionResponse & { supplier: string; supplierPda: string }> {
  return request(`${BACKEND_URL}/api/supply-chain/suppliers/${address}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function confirmRevokeSupplier(
  address: string,
  body: { txSignature: string },
): Promise<{ ok: boolean; supplier: string }> {
  return request(
    `${BACKEND_URL}/api/supply-chain/suppliers/${address}/revoke/confirm`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
}

export async function fetchProducts(): Promise<ProductRecord[]> {
  return request(`${BACKEND_URL}/api/supply-chain/products`, {
    cache: "no-store",
  });
}

export async function registerProduct(body: {
  adminWallet: string;
  sku: string;
  units: string;
  /** 审计 D-01：供应商钱包公钥（供应商注册时必填，管理员注册可省略）。 */
  supplierKey?: string;
}): Promise<BuiltTransactionResponse & { productPda: string }> {
  return request(`${BACKEND_URL}/api/supply-chain/products`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function confirmRegisterProduct(body: {
  adminWallet: string;
  sku: string;
  units: string;
  txSignature: string;
  supplierKey?: string;
}): Promise<{ ok: boolean; product: ProductRecord }> {
  return request(`${BACKEND_URL}/api/supply-chain/products/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
