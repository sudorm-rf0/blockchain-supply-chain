import { BACKEND_URL } from "./env";
import { request } from "./http";

export interface SystemSettings {
  platform: {
    name: string;
    supportEmail: string;
  };
  security: {
    maxLoginFailures: number;
    lockoutMinutes: number;
    sessionMaxAgeHours: number;
    requireTotpForAdmins: boolean;
  };
  registration: {
    allowRegister: boolean;
  };
  upload: {
    maxSizeMB: number;
    allowDuplicate: boolean;
  };
  notifications: {
    fileReviewed: boolean;
    tradeStatus: boolean;
    withdrawalStatus: boolean;
    system: boolean;
  };
}

/** 深层可选：前端只提交被修改的字段 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export async function getSettings(): Promise<SystemSettings> {
  return request(`${BACKEND_URL}/api/admin/settings`, { cache: "no-store" });
}

export async function updateSettings(
  patch: DeepPartial<SystemSettings>,
): Promise<SystemSettings> {
  return request(`${BACKEND_URL}/api/admin/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function resetSettings(): Promise<SystemSettings> {
  return request(`${BACKEND_URL}/api/admin/settings/reset`, {
    method: "POST",
  });
}
