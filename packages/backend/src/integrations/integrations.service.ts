import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { PrismaService } from "../prisma/prisma.service";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function generateApiKey(): string {
  return `sk_live_${randomBytes(24).toString("base64url")}`;
}

/** 判断 IP 是否属于内网/保留/链路本地地址（含 IPv4 映射的 IPv6） */
function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const p = ip.split(".").map(Number);
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // 169.254/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15
    if (a >= 224) return true; // 组播/保留
    return false;
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (/^f[cd]/i.test(lower)) return true; // fc00::/7
    if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local
    if (/^::ffff:(127|10|192\.168)\./.test(lower)) return true; // v4-mapped 私网
    return false;
  }
  return true; // 无法识别按私网处理（fail-closed）
}

/** 可选域名白名单：配置 ALLOWED_WEBHOOK_HOSTS（逗号分隔）后仅允许这些域名 */
function allowedWebhookHost(host: string): boolean {
  const raw = process.env.ALLOWED_WEBHOOK_HOSTS ?? "";
  const hosts = raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (hosts.length === 0) return true; // 未配置白名单则不做域名限制
  return hosts.includes(host.toLowerCase());
}

/** 校验 webhook URL：协议、非内网字面 IP、非本机/内网域名、可选域名白名单 */
function validateWebhookUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestException("Webhook URL 格式无效");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new BadRequestException("Webhook URL 仅支持 http/https");
  }
  const host = parsed.hostname;
  if (isIP(host)) {
    if (isPrivateIp(host)) {
      throw new BadRequestException("Webhook URL 不允许指向内网/保留地址");
    }
  } else {
    if (/^localhost$/i.test(host) || /\.(local|internal|localhost)$/i.test(host)) {
      throw new BadRequestException("Webhook URL 不允许指向本机/内网域名");
    }
    if (!allowedWebhookHost(host)) {
      throw new BadRequestException("Webhook 域名不在白名单内");
    }
  }
  return parsed;
}

/** 发送前解析域名并复检目标 IP（防 DNS rebinding 到内网） */
async function assertPublicWebhookHost(host: string): Promise<void> {
  let records: Array<{ address: string }>;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new BadRequestException("Webhook 域名无法解析");
  }
  for (const { address } of records) {
    if (isPrivateIp(address)) {
      throw new BadRequestException("Webhook 目标域名解析到内网地址，已拒绝发送");
    }
  }
}

@Injectable()
export class IntegrationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listApiKeys(userId: string) {
    const rows = await this.prisma.apiKey.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, prefix: true, role: true,
        lastUsedAt: true, expiresAt: true, createdAt: true,
      },
    });
    return {
      items: rows.map((r) => ({
        ...r,
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async createApiKey(
    userId: string,
    input: { name?: string; role?: string },
  ) {
    const name = (input.name ?? "").trim();
    if (!name || name.length > 64) {
      throw new BadRequestException("名称不能为空且不超过 64 字符");
    }
    const role = input.role === "ADMIN" ? "ADMIN" : "USER";
    const raw = generateApiKey();
    const row = await this.prisma.apiKey.create({
      data: {
        name,
        keyHash: sha256(raw),
        prefix: raw.slice(0, 12),
        role,
        userId,
      },
    });
    return { id: row.id, name: row.name, prefix: row.prefix, role: row.role, key: raw };
  }

  async revokeApiKey(userId: string, id: string) {
    const res = await this.prisma.apiKey.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw new NotFoundException("API Key 不存在或已撤销");
    return { ok: true };
  }

  async listWebhooks(userId: string) {
    const rows = await this.prisma.webhook.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, url: true, events: true, active: true,
        lastSentAt: true, createdAt: true, updatedAt: true,
      },
    });
    return {
      items: rows.map((r) => ({
        ...r,
        lastSentAt: r.lastSentAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  async createWebhook(
    userId: string,
    input: { name?: string; url?: string; events?: string[]; active?: boolean },
  ) {
    const name = (input.name ?? "").trim();
    const url = (input.url ?? "").trim();
    if (!name || name.length > 64) throw new BadRequestException("名称不能为空");
    if (url.length > 512) throw new BadRequestException("Webhook URL 不能超过 512 字符");
    validateWebhookUrl(url);
    const events = (input.events ?? []).filter((e) => typeof e === "string" && e.length <= 64).slice(0, 20);
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const row = await this.prisma.webhook.create({
      data: {
        name,
        url,
        events: events as never,
        secretHash: sha256(secret),
        active: input.active ?? true,
        userId,
      },
    });
    return { id: row.id, name: row.name, url: row.url, secret };
  }

  async updateWebhook(
    userId: string,
    id: string,
    input: { name?: string; url?: string; events?: string[]; active?: boolean },
  ) {
    const existing = await this.prisma.webhook.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException("Webhook 不存在");
    const url = input.url?.trim() ?? existing.url;
    if (url.length > 512) throw new BadRequestException("Webhook URL 不能超过 512 字符");
    validateWebhookUrl(url);
    const updated = await this.prisma.webhook.update({
      where: { id },
      data: {
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        url,
        ...(input.events ? { events: input.events.slice(0, 20) as never } : {}),
        ...(typeof input.active === "boolean" ? { active: input.active } : {}),
      },
    });
    return { id: updated.id, name: updated.name, url: updated.url, active: updated.active };
  }

  async deleteWebhook(userId: string, id: string) {
    const res = await this.prisma.webhook.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new NotFoundException("Webhook 不存在");
    return { ok: true };
  }

  async testWebhook(userId: string, id: string) {
    const hook = await this.prisma.webhook.findFirst({ where: { id, userId } });
    if (!hook) throw new NotFoundException("Webhook 不存在");
    const payload = {
      event: "webhook.test",
      timestamp: new Date().toISOString(),
      data: { message: "DFR Supply Chain 测试推送" },
    };
    try {
      await assertPublicWebhookHost(new URL(hook.url).hostname);
      const secret = process.env.WEBHOOK_HMAC_SECRET ?? "dfr-supply-chain";
      const body = JSON.stringify(payload);
      const signature = createHash("sha256")
        .update(`${secret}${body}`)
        .digest("hex");
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": signature,
          "user-agent": "dfr-supply-chain-webhook/1.0",
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      await this.prisma.webhook.update({
        where: { id },
        data: { lastSentAt: new Date() },
      });
      return { ok: res.ok, status: res.status, message: `HTTP ${res.status}` };
    } catch (error) {
      return { ok: false, status: 0, message: String(error).slice(0, 160) };
    }
  }
}
