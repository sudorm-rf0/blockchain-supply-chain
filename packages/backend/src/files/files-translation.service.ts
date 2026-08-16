import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { Prisma } from "@prisma/client";
import { AiLlmService } from "../ai/ai-llm.service";

export type TranslateLang = "en" | "zh-CN" | "zh-TW";

interface TranslationRecord {
  text: string;
  createdAt: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  verifiedBy: string | null;
  verifiedAt: string | null;
}

const MYMEMORY_CHUNK = 450; // MyMemory 免费接口单次约 500 字符

@Injectable()
export class FilesTranslationService {
  private readonly logger = new Logger(FilesTranslationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: AiLlmService,
  ) {}

  /** 简单语言检测：含较多中文按 zh-CN，否则按 en */
  private detectSourceLang(text: string): TranslateLang {
    const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    return cjk / Math.max(1, text.length) > 0.05 ? "zh-CN" : "en";
  }

  /** 按行分块，单块不超过 limit 字符 */
  private splitChunks(text: string, limit: number): string[] {
    const lines = text.split("\n");
    const chunks: string[] = [];
    let cur = "";
    for (const line of lines) {
      if ((cur + "\n" + line).length > limit && cur) {
        chunks.push(cur);
        cur = line;
      } else {
        cur = cur ? cur + "\n" + line : line;
      }
    }
    if (cur) chunks.push(cur);
    return chunks.length > 0 ? chunks : [""];
  }

  /**
   * AI 翻译：先结合上下文修正 OCR 乱码（错字/字符错位/多余符号/表格串行），再译为目标语言。
   * 失败抛出异常，由调用方回退免费接口。
   */
  private async translateWithAi(text: string, source: TranslateLang, target: TranslateLang): Promise<string> {
    if (!text.trim()) return "";
    const targetName =
      target === "en" ? "英文（English）" : target === "zh-TW" ? "繁体中文" : "简体中文";
    const sourceName = source === "en" ? "英文" : "中文";
    const reply = await this.llm.complete(
      [
        {
          role: "system",
          content:
            "你是供应链金融单据的 OCR 校正与专业翻译专家。用户提供的文本来自 OCR 识别，可能包含乱码、错字、字符错位、多余符号或表格串行。" +
            `请先结合上下文修正 OCR 错误，再完整翻译为${targetName}。` +
            "要求：只输出翻译结果，不要任何解释、注释或原文；使用正式、专业、书面的语气；不要使用列表、编号、加粗、Markdown、星号、杠、省略号、竖线或 emoji；保持段落换行结构。",
        },
        { role: "user", content: `【源语言】${sourceName}\n\n${text}` },
      ],
      4000,
    );
    if (!reply) throw new Error("AI 翻译返回为空");
    return reply;
  }

  private async translateChunk(text: string, source: TranslateLang, target: TranslateLang): Promise<string> {
    const pair = `${source}|${target}`;
    // 1) MyMemory（免费、无需 key）
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const j = (await res.json()) as {
        responseStatus?: number;
        responseData?: { translatedText?: string };
      };
      if (j.responseStatus === 200 && j.responseData?.translatedText) {
        return j.responseData.translatedText;
      }
    } catch (e) {
      this.logger.warn(`mymemory failed: ${String(e)}`);
    }
    // 2) Google gtx（免费接口兜底）
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const j = (await res.json()) as unknown[][];
      if (Array.isArray(j) && Array.isArray(j[0])) {
        return j[0]
          .map((seg) => (Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : ""))
          .join("");
      }
    } catch (e) {
      this.logger.warn(`google gtx failed: ${String(e)}`);
    }
    throw new BadRequestException("翻译服务暂不可用，请稍后重试");
  }

  private async translateLong(text: string, source: TranslateLang, target: TranslateLang): Promise<string> {
    // 优先：AI 清洗 OCR 乱码 + 翻译（质量更高）
    try {
      const chunks = this.splitChunks(text, 1500);
      const parts: string[] = [];
      for (const c of chunks) {
        parts.push(await this.translateWithAi(c, source, target));
      }
      return parts.join("\n\n");
    } catch (error) {
      this.logger.warn(`AI 翻译失败，回退免费接口：${String(error)}`);
    }
    // 回退：免费翻译接口
    const chunks = this.splitChunks(text, MYMEMORY_CHUNK);
    const parts: string[] = [];
    for (const c of chunks) {
      parts.push(await this.translateChunk(c, source, target));
    }
    return parts.join("\n");
  }

  async translate(fileId: string, targetLang: TranslateLang, actorId: string) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException("文件不存在");
    if (!file.ocrText) {
      throw new BadRequestException("该文档未识别出文字内容，无法翻译（请先完成 OCR 分析）");
    }
    const source = this.detectSourceLang(file.ocrText);
    if (source === targetLang) {
      throw new BadRequestException("目标语言与文档原文语言相同，无需翻译");
    }
    const translated = await this.translateLong(file.ocrText, source, targetLang);

    const translations = (file.translations ?? {}) as unknown as Record<string, TranslationRecord>;
    const record: TranslationRecord = {
      text: translated,
      createdAt: new Date().toISOString(),
      status: "PENDING",
      verifiedBy: null,
      verifiedAt: null,
    };
    translations[targetLang] = record;

    await this.prisma.file.update({
      where: { id: fileId },
      data: { translations: translations as unknown as Prisma.InputJsonValue },
    });
    await this.audit.record({
      actorId,
      action: "FILE_TRANSLATED",
      targetType: "FILE",
      targetId: fileId,
      metadata: { targetLang, sourceLang: source, chars: translated.length },
    });
    return { targetLang, sourceLang: source, ...record };
  }

  async verify(fileId: string, lang: TranslateLang, action: "approve" | "reject", adminId: string) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException("文件不存在");
    const translations = (file.translations ?? {}) as unknown as Record<string, TranslationRecord>;
    const record = translations[lang];
    if (!record) throw new NotFoundException("该语言翻译不存在");
    record.status = action === "approve" ? "APPROVED" : "REJECTED";
    record.verifiedBy = adminId;
    record.verifiedAt = new Date().toISOString();
    translations[lang] = record;
    await this.prisma.file.update({
      where: { id: fileId },
      data: { translations: translations as unknown as Prisma.InputJsonValue },
    });
    await this.audit.record({
      actorId: adminId,
      action: action === "approve" ? "TRANSLATION_APPROVED" : "TRANSLATION_REJECTED",
      targetType: "FILE",
      targetId: fileId,
      metadata: { lang },
    });
    return { targetLang: lang, ...record };
  }
}
