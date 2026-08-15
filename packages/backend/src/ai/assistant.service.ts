import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RedisService } from "@supply-chain/common";
import { AiLlmService, type AiChatMessage } from "./ai-llm.service";
import { AuditService } from "../audit/audit.service";
import type { AiChatDto } from "./dto/ai-chat.dto";

/** 对话历史保留时长：30 天 */
const HISTORY_TTL_SECONDS = 30 * 24 * 60 * 60;
/** 每用户最多保留的会话数 */
const MAX_SESSIONS = 50;
/** 单会话最多保留的消息数 */
const MAX_MESSAGES = 100;
/** 送入 LLM 的上下文最近消息数 */
const MAX_CONTEXT_MESSAGES = 20;

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

interface StoredSession {
  id: string;
  title: string;
  messages: StoredMessage[];
  createdAt: string;
  updatedAt: string;
}

/** 平台操作知识库：引导用户完成常用操作、答疑解惑 */
const SYSTEM_PROMPT = `你是「DFR 供应链金融平台」的 AI 助手，负责引导用户完成平台操作、解答疑问。
平台是构建在 Solana 区块链上的供应链金融系统，角色分为普通用户、管理员、超级管理员。

【常用操作指引】
1. 上传单据：左侧菜单「上传文件」（/user/upload）。支持 PDF/图片（最大 50MB），可填写 tradeId、单据编号、描述、备注；上传后自动做 OCR 与真伪分析，也可用钱包对文件哈希存证上链。
2. 我的文件：左侧「我的文件」（/user/files），可预览、下载、查看识别与审核状态。
3. 创建贸易订单：进入「创建订单」页（/trade/new）。先连接钱包，填写贸易金额（USDC）、账期（30/60/90/120 天），可填订单名称与备注；订单采用 30% 首付 + 70% 资金池垫付，钱包确认签名后上链。
4. 我的订单：左侧「我的订单」（/orders）。状态流转：待放款→已放款→运输中→已清关→已交付→还款中→已结清（或已违约）；买方在「还款中」可发起还款。
5. 文件审核（管理员）：左侧「文件审核」（/admin/files），处理待审核单据，可单条或批量通过/驳回、预览、重新分析，也可用「AI 助手」生成审核报告并提问。
6. 全部文件（管理员）：左侧「全部文件」（/admin/files）。
7. 订单管理（管理员）：左侧「全部订单」（/admin/trades），可拨款、推进物流状态、标记违约、释放资金。
8. 绑定钱包：头像菜单 → 安全设置（/security），输入钱包地址并完成邮箱验证码校验。
9. 双重验证（TOTP）：安全设置（/security）开启后，登录需输入 6 位动态验证码。
10. 修改名称/邮箱/密码：头像菜单 → 管理账号信息（/account）；修改名称与邮箱需邮箱验证码，修改密码需原密码。
11. 融资申请：左侧「融资管理」（/financing），选择已审核通过的发票申请融资，金额不超过发票金额 ×（1 - 折扣率）。
12. 意见反馈：管理账号信息（/account）页面底部「意见反馈」卡片，填写内容与选填联系方式提交。
13. 多语言：头像菜单可切换简体/繁体/英文；主题切换在页面顶部。
14. 邀请码统计（超级管理员）：左侧「邀请码统计」（/admin/invite-codes）。
15. 供应链管理（管理员）：左侧「供应链管理」（/admin/supply-chain）。

【回答规范】
- 用自然、口语化的语气回答，像熟悉平台的朋友在聊天，不要套用任何模板。
- 禁止使用编号列表、项目符号、加粗、标题、Markdown 等结构化格式；需要说步骤时用「先…然后…最后…」这样的自然语句串联。
- 不要使用任何 emoji。
- 先直接回答问题，再顺带提示关键前置条件（例如需要先连接钱包、需要邮箱验证码、需要管理员权限），提示可以用自然的一句话带过。
- 用与用户提问相同的语言回答；信息不足时如实说明，不要编造。
- 涉及密码、私钥、验证码等敏感信息时提醒用户注意安全、不要泄露。
- 回答自然、简洁，像人话。`;

@Injectable()
export class AssistantService {
  constructor(
    private readonly llm: AiLlmService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  private sessionKey(userId: string, sessionId: string): string {
    return `ai:msg:${userId}:${sessionId}`;
  }

  private indexKey(userId: string): string {
    return `ai:hist:${userId}`;
  }

  private async readSession(userId: string, sessionId: string): Promise<StoredSession | null> {
    const raw = await this.redis.get(this.sessionKey(userId, sessionId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredSession;
      return parsed && typeof parsed.id === "string" ? parsed : null;
    } catch {
      return null;
    }
  }

  private async readIndex(userId: string): Promise<SessionMeta[]> {
    const raw = await this.redis.get(this.indexKey(userId));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as SessionMeta[]) : [];
    } catch {
      return [];
    }
  }

  private async writeSession(userId: string, session: StoredSession): Promise<void> {
    await this.redis.setEx(
      this.sessionKey(userId, session.id),
      HISTORY_TTL_SECONDS,
      JSON.stringify(session),
    );
  }

  private async writeIndex(userId: string, metas: SessionMeta[]): Promise<void> {
    await this.redis.setEx(this.indexKey(userId), HISTORY_TTL_SECONDS, JSON.stringify(metas));
  }

  async chat(userId: string, dto: AiChatDto) {
    let session: StoredSession;
    if (dto.sessionId) {
      const existing = await this.readSession(userId, dto.sessionId);
      if (!existing) throw new NotFoundException("会话不存在或已过期，请开始新对话");
      session = existing;
    } else {
      session = {
        id: randomUUID(),
        title: dto.message.trim().slice(0, 30),
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // 上下文：服务端持久化的会话历史优先；兼容客户端直接传入 history
    const storedHistory: AiChatMessage[] = session.messages.slice(-MAX_CONTEXT_MESSAGES);
    const fallbackHistory: AiChatMessage[] = (dto.history ?? [])
      .slice(-MAX_CONTEXT_MESSAGES)
      .map((m): AiChatMessage => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? "").slice(0, 4000),
      }))
      .filter((m) => m.content.length > 0);
    const history = storedHistory.length > 0 ? storedHistory : fallbackHistory;

    const messages: AiChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: dto.message },
    ];
    const reply = await this.llm.complete(messages, 1000);

    // 持久化：追加用户消息 + AI 回复，刷新 30 天 TTL
    const nextMessages: StoredMessage[] = [
      ...session.messages,
      { role: "user" as const, content: dto.message },
      { role: "assistant" as const, content: reply },
    ].slice(-MAX_MESSAGES);
    session.messages = nextMessages;
    session.updatedAt = new Date().toISOString();
    await this.writeSession(userId, session);

    const metas = (await this.readIndex(userId)).filter((m) => m.id !== session.id);
    const meta: SessionMeta = {
      id: session.id,
      title: session.title,
      messageCount: session.messages.length,
      updatedAt: session.updatedAt,
    };
    await this.writeIndex(userId, [meta, ...metas].slice(0, MAX_SESSIONS));

    await this.audit.record({
      actorId: userId,
      action: "AI_ASSISTANT_CHAT",
      targetType: "AI_ASSISTANT",
      targetId: userId,
      metadata: {
        model: this.llm.modelName,
        sessionId: session.id,
        question: dto.message.slice(0, 200),
      },
    });
    return { reply, sessionId: session.id };
  }

  /** 历史会话列表（按最近更新倒序） */
  async listHistory(userId: string): Promise<SessionMeta[]> {
    const metas = await this.readIndex(userId);
    // 用户仍在查看历史，续期索引
    await this.redis.expire(this.indexKey(userId), HISTORY_TTL_SECONDS).catch(() => undefined);
    return metas;
  }

  /** 恢复某个会话的完整消息 */
  async getHistory(userId: string, sessionId: string) {
    const session = await this.readSession(userId, sessionId);
    if (!session) throw new NotFoundException("会话不存在或已过期");
    await this.redis
      .expire(this.sessionKey(userId, sessionId), HISTORY_TTL_SECONDS)
      .catch(() => undefined);
    return {
      id: session.id,
      title: session.title,
      messages: session.messages,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /** 删除单个会话（传 sessionId）或清空全部（不传） */
  async deleteHistory(userId: string, sessionId?: string) {
    if (sessionId) {
      await this.redis.del(this.sessionKey(userId, sessionId));
      const metas = (await this.readIndex(userId)).filter((m) => m.id !== sessionId);
      if (metas.length > 0) {
        await this.writeIndex(userId, metas);
      } else {
        await this.redis.del(this.indexKey(userId));
      }
      return { ok: true, deleted: 1 };
    }
    const metas = await this.readIndex(userId);
    await Promise.all(metas.map((m) => this.redis.del(this.sessionKey(userId, m.id))));
    await this.redis.del(this.indexKey(userId));
    return { ok: true, deleted: metas.length };
  }
}
