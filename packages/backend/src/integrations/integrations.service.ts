import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function generateApiKey(): string {
  return `sk_live_${randomBytes(24).toString("base64url")}`;
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
    input: { name: string; role?: string },
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
    input: { name: string; url: string; events: string[]; active?: boolean },
  ) {
    const name = (input.name ?? "").trim();
    const url = (input.url ?? "").trim();
    if (!name || name.length > 64) throw new BadRequestException("名称不能为空");
    if (!/^https?:\/\//.test(url) || url.length > 512) {
      throw new BadRequestException("Webhook URL 必须是 http(s) 且不超过 512 字符");
    }
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
    if (!/^https?:\/\//.test(url) || url.length > 512) {
      throw new BadRequestException("Webhook URL 必须是 http(s) 且不超过 512 字符");
    }
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
