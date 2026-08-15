import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "@supply-chain/common";
import { AuditService } from "../audit/audit.service";

/** 系统可配置项（运行时设置，存 Redis，无需改代码/迁移数据库） */
export interface SystemSettings {
  platform: {
    /** 平台名称 */
    name: string;
    /** 支持邮箱 */
    supportEmail: string;
  };
  security: {
    /** 连续登录失败多少次后锁定（默认 5） */
    maxLoginFailures: number;
    /** 锁定分钟数（默认 15） */
    lockoutMinutes: number;
    /** 登录会话（refresh token）有效期小时数（默认 24） */
    sessionMaxAgeHours: number;
    /** 管理员是否强制开启 TOTP 两步验证（默认关闭，开启后未开启 TOTP 的管理员无法登录） */
    requireTotpForAdmins: boolean;
  };
  registration: {
    /** 是否开放注册（默认开） */
    allowRegister: boolean;
  };
  upload: {
    /** 单文件大小上限 MB（默认 50） */
    maxSizeMB: number;
    /** 是否允许重复上传（默认否，后端防重） */
    allowDuplicate: boolean;
  };
  notifications: {
    /** 文件审核结果通知（默认开） */
    fileReviewed: boolean;
    /** 订单状态变更通知（默认开） */
    tradeStatus: boolean;
    /** 提款状态通知（默认开） */
    withdrawalStatus: boolean;
    /** 系统通知（默认开） */
    system: boolean;
  };
}

export const DEFAULT_SETTINGS: SystemSettings = {
  platform: { name: "DFR 区块链 · 供应链系统", supportEmail: "" },
  security: {
    maxLoginFailures: 5,
    lockoutMinutes: 15,
    sessionMaxAgeHours: 24,
    requireTotpForAdmins: false,
  },
  registration: { allowRegister: true },
  upload: { maxSizeMB: 50, allowDuplicate: false },
  notifications: {
    fileReviewed: true,
    tradeStatus: true,
    withdrawalStatus: true,
    system: true,
  },
};

/** 深层可选：支持只传需要修改的嵌套字段 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const SETTINGS_KEY = "sys:settings";
const SETTINGS_TTL_SECONDS = 30 * 24 * 3600; // 30 天滚动续期

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 深合并：以 base 为骨架，patch 覆盖（仅合并存在的键，忽略多余键） */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isRecord(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    const bv = (base as Record<string, unknown>)[key];
    if (isRecord(bv) && isRecord(pv)) {
      out[key] = deepMerge(bv, pv);
    } else if (key in out) {
      out[key] = pv;
    }
  }
  return out as T;
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 运行时系统设置（超管可改，存 Redis）。与并行任务的文件/通知模块隔离。 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  constructor(
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<SystemSettings> {
    try {
      const raw = await this.redis.get(SETTINGS_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      const parsed = JSON.parse(raw) as unknown;
      return deepMerge(DEFAULT_SETTINGS, parsed);
    } catch (error) {
      this.logger.warn(`settings read failed, using defaults: ${String(error)}`);
      return DEFAULT_SETTINGS;
    }
  }

  async update(
    patch: DeepPartial<SystemSettings>,
    actor: { id: string; email?: string | null },
  ): Promise<SystemSettings> {
    const current = await this.get();
    const next = deepMerge(current, patch);
    // 数值字段做范围约束，防止超管误填导致异常
    next.security.maxLoginFailures = clampInt(
      next.security.maxLoginFailures,
      DEFAULT_SETTINGS.security.maxLoginFailures,
      1,
      50,
    );
    next.security.lockoutMinutes = clampInt(
      next.security.lockoutMinutes,
      DEFAULT_SETTINGS.security.lockoutMinutes,
      1,
      1440,
    );
    next.security.sessionMaxAgeHours = clampInt(
      next.security.sessionMaxAgeHours,
      DEFAULT_SETTINGS.security.sessionMaxAgeHours,
      1,
      720,
    );
    next.upload.maxSizeMB = clampInt(
      next.upload.maxSizeMB,
      DEFAULT_SETTINGS.upload.maxSizeMB,
      1,
      1024,
    );
    await this.redis.setWithExpiry(
      SETTINGS_KEY,
      JSON.stringify(next),
      SETTINGS_TTL_SECONDS,
    );
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email ?? undefined,
      action: "SETTINGS_UPDATED",
      targetType: "SYSTEM",
      targetId: "settings",
      metadata: { keys: Object.keys(patch) },
    });
    return next;
  }

  async reset(actor: { id: string; email?: string | null }): Promise<SystemSettings> {
    await this.redis.del(SETTINGS_KEY);
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email ?? undefined,
      action: "SETTINGS_RESET",
      targetType: "SYSTEM",
      targetId: "settings",
    });
    return DEFAULT_SETTINGS;
  }
}
