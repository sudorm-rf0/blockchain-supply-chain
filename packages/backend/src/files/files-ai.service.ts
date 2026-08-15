import {
  ForbiddenException,
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
  ) {}

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

  /** 生成 AI 审核报告（摘要 + 风险评估 + 建议） */
  async review(fileId: string, userId: string, role: string): Promise<AiReviewReport> {
    const file = await this.requireFile(fileId, userId, role);
    const ocrText = await this.resolveOcrText(file);
    const context = this.buildContext(file, ocrText);
    const raw = await this.llm.complete([
      {
        role: "system",
        content:
          "你是供应链金融平台的单据审核专家。请基于单据内容文本、关键字段和本地检测结果，输出一个 JSON 对象（不要输出 JSON 以外的任何内容），字段为：" +
          '{"summary":"用自然语言概括单据内容","riskLevel":"LOW|MEDIUM|HIGH","riskAssessment":"用自然语言说明风险点","suggestions":["审核建议"],"concerns":["可疑或需人工复核点"]}。' +
          "要求：所有文本字段都用自然、平实的语言，不要使用列表、编号、加粗、Markdown 或 emoji；即使内容需要多点说明，也用连贯的句子表达。",
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
          "你是供应链金融平台的单据审核 AI 助手。请基于下方单据内容回答用户问题；信息不足时如实说明，不要编造。用自然、口语化的语气回答，与用户提问使用相同语言，不要使用列表、编号、加粗、Markdown 或 emoji。\n\n" +
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
