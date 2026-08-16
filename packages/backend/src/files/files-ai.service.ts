import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createWriteStream,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AiLlmService, type AiChatMessage } from "../ai/ai-llm.service";
import { RedisService } from "@supply-chain/common";
import type { StorageService } from "../storage/storage.service";
import type { AiChatDto } from "./dto/ai-chat.dto";

/** AI 能力开关由环境变量控制：AI_API_KEY 未配置时返回 503（fail-closed）。 */
const MAX_CONTEXT_CHARS = 12000;
/** 注入到 AI 上下文的 PDF 自动提取文本上限 */
const MAX_PDF_TEXT_CHARS = 12000;

const execFileAsync = promisify(execFile);

export interface AiReviewReport {
  summary: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  riskAssessment: string;
  suggestions: string[];
  concerns: string[];
}

interface FileForAi {
  id: string;
  path: string;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: AiLlmService,
    @Inject("STORAGE_SERVICE") private readonly storage: StorageService,
    private readonly redis: RedisService,
  ) {}

  /** AI 每用户每日配额（AI_DAILY_QUOTA，默认 100 次/天） */
  private async consumeQuota(userId: string): Promise<void> {
    const limit = Number(process.env.AI_DAILY_QUOTA ?? 100);
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const key = `ai:quota:${userId}:${day}`;
    const used = await this.redis.incr(key);
    if (used === 1) {
      await this.redis.expire(key, 86400);
    }
    if (used > limit) {
      throw new HttpException(
        `今日 AI 使用次数已达上限（${limit} 次）`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
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

  /**
   * 解析单据文本内容：
   * 1) 优先使用平台已有 OCR 结果（上传时自动识别）；
   * 2) PDF 且无 OCR 结果时，自动用 pdftotext 直接提取文本，保证 AI 能读到内容。
   */
  private async resolveOcrText(file: FileForAi): Promise<string> {
    const stored = (file.ocrText ?? "").trim();
    if (stored) return stored;
    if (file.mimeType !== "application/pdf") return "";
    const dir = mkdtempSync(join(tmpdir(), "dfr-aipdf-"));
    try {
      const target = join(dir, "doc.pdf");
      const stream = await this.storage.open(file.path);
      await pipeline(stream as NodeJS.ReadableStream, createWriteStream(target));
      const { stdout } = await execFileAsync("pdftotext", [target, "-"], {
        timeout: 60_000,
        maxBuffer: 20 * 1024 * 1024,
      });
      const text = stdout.trim();
      if (!text) return "";
      this.logger.log(`pdf text auto-extracted for file ${file.id} (${text.length} chars)`);
      return `【自动提取 PDF 文本】\n${text.slice(0, MAX_PDF_TEXT_CHARS)}`;
    } catch (error) {
      this.logger.warn(`pdf text extraction failed for ${file.id}: ${String(error)}`);
      return "";
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private buildContext(file: FileForAi, ocrText: string): string {
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
    if (ocrText) {
      lines.push(
        `单据内容文本（截取前 ${MAX_CONTEXT_CHARS} 字符）：\n${ocrText.slice(0, MAX_CONTEXT_CHARS)}`,
      );
    } else {
      lines.push("单据内容文本：无（未能从文件中提取到可读文本）");
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

  /** AI 结构化关键信息提取：发票/合同/报关单等字段 → JSON */
  async extract(fileId: string, userId: string, role: string) {
    await this.consumeQuota(userId);
    const file = await this.requireFile(fileId, userId, role);
    const ocrText = await this.resolveOcrText(file);
    const context = this.buildContext(file, ocrText);
    const raw = await this.llm.complete([
      {
        role: "system",
        content:
          "你是供应链金融单据信息提取专家。基于单据内容文本输出一个 JSON 对象（不要输出 JSON 以外的任何内容），字段为：" +
          '{"invoiceNumber":"发票号","contractNo":"合同号","amount":"金额（含币种）","date":"日期","buyer":"买方","seller":"卖方","currency":"币制","preEntryNo":"报关预录入编号","customsNo":"海关编号","consignee":"境内收货人","shipper":"境外发货人","transportMode":"运输方式","notes":"其他补充说明"}。' +
          "识别不到的字段给 null；字段值用自然语言，不要使用列表、编号、加粗、Markdown、表格或 emoji；禁止出现星号 *、杠（-、—、–）、省略号（…）、竖线 | 等符号。",
      },
      { role: "user", content: context },
    ]);
    const fields =
      this.parseJsonObject<Record<string, unknown>>(raw) ?? { raw };
    await this.audit.record({
      actorId: userId,
      action: "FILE_AI_EXTRACTED",
      targetType: "FILE",
      targetId: fileId,
      metadata: { model: this.llm.modelName, fields: Object.keys(fields) },
    });
    return {
      fields,
      source: ocrText.startsWith("【自动提取 PDF 文本】") ? "pdftotext" : "ocr",
    };
  }

  /** AI 文档摘要：3-5 句自然语言概括核心内容 */
  async summarize(fileId: string, userId: string, role: string) {
    await this.consumeQuota(userId);
    const file = await this.requireFile(fileId, userId, role);
    const ocrText = await this.resolveOcrText(file);
    const context = this.buildContext(file, ocrText);
    const summary = await this.llm.complete(
      [
        {
          role: "system",
          content:
            "你是供应链金融单据摘要助手。请用 3-5 句正式的书面语言概括这份单据的核心内容：单据类型、关键金额与日期、交易双方、主要风险提示。措辞专业严谨，避免口语化表达；不要使用列表、编号、加粗、Markdown、表格或 emoji；禁止出现星号 *、杠（-、—、–）、省略号（…）、竖线 | 等符号。",
        },
        { role: "user", content: context },
      ],
      800,
    );
    await this.audit.record({
      actorId: userId,
      action: "FILE_AI_SUMMARIZED",
      targetType: "FILE",
      targetId: fileId,
      metadata: { model: this.llm.modelName },
    });
    return { summary };
  }

  /** 生成 AI 审核报告（摘要 + 风险评估 + 建议） */
  async review(fileId: string, userId: string, role: string): Promise<AiReviewReport> {
    await this.consumeQuota(userId);
    const file = await this.requireFile(fileId, userId, role);
    const ocrText = await this.resolveOcrText(file);
    const context = this.buildContext(file, ocrText);
    const raw = await this.llm.complete([
      {
        role: "system",
        content:
          "你是供应链金融平台的单据审核专家。请基于单据内容文本、关键字段和本地检测结果，输出一个 JSON 对象（不要输出 JSON 以外的任何内容），字段为：" +
          '{"summary":"用自然语言概括单据内容","riskLevel":"LOW|MEDIUM|HIGH","riskAssessment":"用自然语言说明风险点","suggestions":["审核建议"],"concerns":["可疑或需人工复核点"]}。' +
          "要求：所有文本字段都用自然、平实的语言，不要使用列表、编号、加粗、Markdown、表格或 emoji；禁止出现星号 *、杠（-、—、–）、省略号（…）、竖线 | 等符号；即使内容需要多点说明，也用连贯的句子表达。",
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
      metadata: { riskLevel: normalized.riskLevel, model: this.llm.modelName },
    });
    return normalized;
  }

  /** AI 助手对话：基于单据内容自然问答 */
  async chat(fileId: string, userId: string, role: string, dto: AiChatDto) {
    await this.consumeQuota(userId);
    const file = await this.requireFile(fileId, userId, role);
    const ocrText = await this.resolveOcrText(file);
    const context = this.buildContext(file, ocrText);
    const history: AiChatMessage[] = (dto.history ?? [])
      .slice(-20)
      .map((m): AiChatMessage => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? "").slice(0, 4000),
      }))
      .filter((m) => m.content.length > 0);
    const messages: AiChatMessage[] = [
      {
        role: "system",
        content:
          "你是供应链金融平台的单据审核 AI 助手。请基于下方单据内容回答用户问题；信息不足时如实说明，不要编造。使用正式、专业的书面语气作答，与用户提问使用相同语言，措辞严谨，避免口语化表达；不要使用列表、编号、加粗、Markdown、表格或 emoji；禁止出现星号 *、杠（-、—、–）、省略号（…）、竖线 | 等符号。\n\n" +
          context,
      },
      ...history,
      { role: "user", content: dto.message },
    ];
    const reply = await this.llm.complete(messages, 1000);
    await this.audit.record({
      actorId: userId,
      action: "FILE_AI_CHAT",
      targetType: "FILE",
      targetId: fileId,
      metadata: { model: this.llm.modelName, question: dto.message.slice(0, 200) },
    });
    return { reply };
  }
}
