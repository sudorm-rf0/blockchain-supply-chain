import { useUserStore } from "@/stores/user-store";
import { BACKEND_URL, API_TIMEOUT_MS } from "./env";
import type { AuthUser } from "./types";

export function formatUsdc(raw: string | number): string {
  return (Number(raw) / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

export async function fetchWithTimeout(
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

export async function requestWithRetry(
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

export async function request<T>(
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
