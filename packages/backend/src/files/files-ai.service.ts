import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AiChatDto } from "./dto/ai-chat.dto";

/** AI 能力开关由环境变量控制：AI_API_KEY 未配置时返回 503（fail-closed）。 */
const MAX_CONTEXT_CHARS = 8000;
const REQUEST_TIMEOUT_MS = 60_000;

export interface AiReviewReport {
  summary: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  riskAssessment: string;
  suggestions: string[];
  concerns: string[];
}

type ChatRole = "system" | "user" | "assistant";
interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface FileForAi {
  id: string;
  filename: string;
  mimeType: string;
  status: string;
  description: string | null;
  remark: string | null;
  ocrText: string | null;
  authScore: number | null;
  authResult: Prisma.JsonValue | null;
  uploaderId: string | null;
}

@Injectable()
export class FilesAiService {
  private readonly logger = new Logger(FilesAiService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    this.apiKey = (process.env.AI_API_KEY ?? "").trim();
    this.baseUrl = (process.env.AI_BASE_URL ?? "https://api.openai.com/v1").trim().replace(/\/+$/, "");
    this.model = (process.env.AI_MODEL ?? "gpt-4o-mini").trim();
    this.enabled = this.apiKey.length > 0;
    if (!this.enabled) {
      this.logger.warn("AI_API_KEY 未配置：AI 审核助手停用（返回 503）");
    }
  }

  private async requireFile(fileId: string, userId: string, role: string): Promise<FileForAi> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException("文件不存在");
    if (role !== "ADMIN" && role !== "SUPER_ADMIN" && file.uploaderId !== userId) {
      throw new ForbiddenException("无权分析此文件");
    }
    return file;
  }

  private async complete(messages: ChatMessage[], maxTokens = 1400): Promise<string> {
    if (!this.enabled) {
      throw new ServiceUnavailableException("AI 服务未配置，请联系管理员（AI_API_KEY）");
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.2,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`ai request threw: ${String(error)}`);
      throw new ServiceUnavailableException("AI 服务暂不可用，请稍后重试");
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.error(`ai api ${response.status}: ${body.slice(0, 300)}`);
      throw new ServiceUnavailableException(
        response.status === 401
          ? "AI 服务鉴权失败，请检查 AI_API_KEY"
          : `AI 服务调用失败（HTTP ${response.status}）`,
      );
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new ServiceUnavailableException("AI 服务返回为空，请重试");
    }
    return content;
  }

  private buildContext(file: FileForAi): string {
    const lines: string[] = [
      `文件名：${file.filename}`,
      `类型：${file.mimeType}`,
      `审核状态：${file.status}`,
    ];
    if (file.description) lines.push(`描述：${file.description}`);
    if (file.remark) lines.push(`备注：${file.remark}`);
    if (file.authScore != null) lines.push(`本地真伪分析得分：${file.authScore}/100`);
    const auth = file.authResult as
      | { verdict?: string; checks?: Array<{ name: string; passed: boolean; detail: string }>; keyFields?: Record<string, string>; validations?: Array<{ name: string; passed: boolean; detail: string }> }
      | null
      | undefined;
    if (auth?.verdict) lines.push(`本地风险等级：${auth.verdict}`);
    if (Array.isArray(auth?.checks) && auth.checks.length > 0) {
      lines.push(
        "本地检测项：" +
          auth.checks
            .map((c) => `${c.passed ? "通过" : "异常"}(${c.name}): ${c.detail}`)
            .join("；"),
      );
    }
    if (auth?.keyFields && Object.keys(auth.keyFields).length > 0) {
      lines.push("识别关键字段：" + JSON.stringify(auth.keyFields));
    }
    if (Array.isArray(auth?.validations) && auth.validations.length > 0) {
      lines.push(
        "字段校验：" +
          auth.validations
            .map((v) => `${v.passed ? "通过" : "异常"}(${v.name}): ${v.detail}`)
            .join("；"),
      );
    }
    const ocr = (file.ocrText ?? "").trim();
    if (ocr) {
      lines.push(
        `OCR 文本（截取前 ${MAX_CONTEXT_CHARS} 字符）：\n${ocr.slice(0, MAX_CONTEXT_CHARS)}`,
      );
    } else {
      lines.push("OCR 文本：无（文件可能尚未完成识别）");
    }
    return lines.join("\n");
  }

  private parseJsonObject<T>(raw: string): T | null {
    try {
      return JSON.parse(raw) as T;
    } catch {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(raw.slice(start, end + 1)) as T;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /** 生成 AI 审核报告（摘要 + 风险评估 + 建议） */
  async review(fileId: string, userId: string, role: string): Promise<AiReviewReport> {
    const file = await this.requireFile(fileId, userId, role);
    const context = this.buildContext(file);
    const raw = await this.complete([
      {
        role: "system",
        content:
          "你是供应链金融平台的单据审核专家。基于提供的单据 OCR 文本、关键字段和本地检测结果，输出 JSON（不要输出 JSON 外的内容），结构为：" +
          '{"summary":"单据内容摘要","riskLevel":"LOW|MEDIUM|HIGH","riskAssessment":"风险分析","suggestions":["审核建议"],"concerns":["可疑/需人工复核点"]}。',
      },
      { role: "user", content: context },
    ]);
    const report = this.parseJsonObject<Partial<AiReviewReport>>(raw);
    const normalized: AiReviewReport = {
      summary: report?.summary ?? raw,
      riskLevel:
        report?.riskLevel === "MEDIUM" || report?.riskLevel === "HIGH"
          ? report.riskLevel
          : "LOW",
      riskAssessment: report?.riskAssessment ?? "",
      suggestions: Array.isArray(report?.suggestions) ? report.suggestions : [],
      concerns: Array.isArray(report?.concerns) ? report.concerns : [],
    };
    await this.audit.record({
      actorId: userId,
      action: "FILE_AI_REVIEWED",
      targetType: "FILE",
      targetId: fileId,
      metadata: { riskLevel: normalized.riskLevel, model: this.model },
    });
    return normalized;
  }

  /** AI 助手对话：基于单据上下文回答问题 */
  async chat(fileId: string, userId: string, role: string, dto: AiChatDto) {
    const file = await this.requireFile(fileId, userId, role);
    const context = this.buildContext(file);
    const history: ChatMessage[] = (dto.history ?? [])
      .slice(-20)
      .map((m): ChatMessage => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? "").slice(0, 4000),
      }))
      .filter((m) => m.content.length > 0);
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "你是供应链金融平台的单据审核 AI 助手。请基于下方单据信息回答用户问题；信息不足时如实说明，不要编造。回答使用与用户提问相同的语言，简洁专业。\n\n" +
          context,
      },
      ...history,
      { role: "user", content: dto.message },
    ];
    const reply = await this.complete(messages, 1000);
    await this.audit.record({
      actorId: userId,
      action: "FILE_AI_CHAT",
      targetType: "FILE",
      targetId: fileId,
      metadata: { model: this.model, question: dto.message.slice(0, 200) },
    });
    return { reply };
  }
}
