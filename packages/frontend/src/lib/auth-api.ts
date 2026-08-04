import { BACKEND_URL } from "./env";
import { request } from "./http";
import type { AuthUser } from "./types";
import { useUserStore } from "@/stores/user-store";

export { AuthUser };

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
