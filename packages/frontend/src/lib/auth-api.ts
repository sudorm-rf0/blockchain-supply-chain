import { BACKEND_URL } from "./env";
import { request } from "./http";
import type { AuthUser } from "./types";
import { useUserStore } from "@/stores/user-store";

export { AuthUser };

export async function login(
  email: string,
  password: string,
  totpCode?: string,
  emailOtpCode?: string,
  turnstileToken?: string,
): Promise<{
  accessToken?: string;
  user: AuthUser;
  mustChangePassword?: boolean;
  requiresTotp?: boolean;
  requiresEmailOtp?: boolean;
  devCode?: string;
}> {
  return request(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, totpCode, emailOtpCode, turnstileToken }),
  });
}

/** 发送邮箱验证码到当前登录用户（开启/关闭 Email OTP、敏感操作确认用） */
export async function sendEmailOtpCode(): Promise<{
  ok: boolean;
  expiresIn: number;
  cooldownSeconds: number;
  devCode?: string;
}> {
  return request(`${BACKEND_URL}/api/auth/email-otp/send`, {
    method: "POST",
  });
}

export async function bindWallet(
  wallet: string,
  emailCode: string,
): Promise<AuthUser> {
  return request(`${BACKEND_URL}/api/auth/wallet`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, emailCode }),
  });
}

export async function setupTotp(): Promise<{
  secret: string;
  otpauthUrl: string;
}> {
  return request(`${BACKEND_URL}/api/auth/totp/setup`, {
    method: "POST",
  });
}

export async function enableTotp(code: string): Promise<{ ok: boolean }> {
  return request(`${BACKEND_URL}/api/auth/totp/enable`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

export async function disableTotp(code: string): Promise<{ ok: boolean }> {
  return request(`${BACKEND_URL}/api/auth/totp/disable`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
  wallet?: string;
  turnstileToken?: string;
}): Promise<{
  accessToken?: string;
  user: AuthUser;
  mustChangePassword?: boolean;
  requiresEmailVerification?: boolean;
  expiresIn?: number;
  cooldownSeconds?: number;
  devCode?: string;
}> {
  return request(`${BACKEND_URL}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** 注册邮箱验证：输入 6 位验证码激活账号 */
export async function verifyEmail(
  email: string,
  code: string,
): Promise<{ ok: boolean; email: string }> {
  return request(`${BACKEND_URL}/api/auth/verify-email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
}

/** 重新发送邮箱验证码（60 秒冷却、每小时最多 5 封） */
export async function sendEmailCode(
  email: string,
): Promise<{
  ok: boolean;
  expiresIn: number;
  cooldownSeconds: number;
  devCode?: string;
}> {
  return request(`${BACKEND_URL}/api/email-verification/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
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

export async function changeEmail(
  newEmail: string,
  emailCode: string,
): Promise<{ ok: boolean; user: AuthUser }> {
  return request(`${BACKEND_URL}/api/auth/change-email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newEmail, emailCode }),
  });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  emailCode: string | undefined,
): Promise<{ ok: boolean; user: AuthUser; mustChangePassword: boolean }> {
  return request(`${BACKEND_URL}/api/auth/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword, emailCode }),
  });
}
