import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { extractKeyFields, validateFields, type KeyFields, type ValidationItem } from "./ocr-fields";
import type { StorageService } from "../storage/storage.service";
import { AuditService } from "../audit/audit.service";

const execFileAsync = promisify(execFile);

export interface AnalysisCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface AnalysisResult {
  score: number;
  verdict: "LOW_RISK" | "MEDIUM_RISK" | "HIGH_RISK";
  checks: AnalysisCheck[];
  ocrText: string;
  /** 文本来源：pdftotext（PDF 文本层）/ tesseract（图像 OCR）/ image-ocr / none */
  ocrSource?: "pdftotext" | "tesseract" | "image-ocr" | "none";
  keyFields?: KeyFields;
  validations?: ValidationItem[];
}

const OCR_LANG = "chi_sim+eng";
const MAX_OCR_PAGES = 12;
/** OCR 图像预处理：灰度 + 对比度归一化 + 轻去噪 + 锐化，降低识别噪声 */
const OCR_PREPROCESS = true;
/** PDF 转图分辨率：300dpi 小字识别明显优于 200dpi */
const OCR_PDF_DPI = 300;
/** 行尾噪声符号（OCR 常见误识，如 tesseract 输出的孤立 + | - = ~ / \\ _） */
const OCR_NOISE_TRAIL = /[+|=\-~/\\_]{1,}\s*$/;
const OCR_NOISE_ONLY_LINE = /^[+|=\-~/\\_\s.,:;'"]{0,4}$/;
/** PDF 文本层提取结果的最短有效长度（太短视为无文本层，回退 OCR） */
const MIN_PDF_TEXT_CHARS = 30;

@Injectable()
export class FilesAnalysisService {
  private readonly logger = new Logger(FilesAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject("STORAGE_SERVICE") private readonly storage: StorageService,
  ) {}

  private async materialize(storageKey: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "dfr-an-"));
    const target = join(dir, "doc.bin");
    const stream = await this.storage.open(storageKey);
    await pipeline(stream as NodeJS.ReadableStream, createWriteStream(target));
    return dir;
  }

  private async sha256(path: string): Promise<string> {
    const hash = createHash("sha256");
    await pipeline(createReadStream(path), hash);
    return hash.digest("hex");
  }

  /**
   * OCR 文本后处理：清除行尾噪声符号、纯符号行、压缩空白，
   * 并修正常见全角/半角混淆，减少乱码进入下游。
   */
  private cleanOcrText(text: string): string {
    if (!text) return text;
    const lines = text
      .split("\n")
      .map((line) => {
        let l = line.replace(OCR_NOISE_TRAIL, "").trim();
        if (OCR_NOISE_ONLY_LINE.test(l)) return "";
        // 常见 OCR 混淆：全角数字/字母 → 半角（中文单据常见）
        l = l
          .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
          .replace(/[Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
        return l;
      })
      .filter((l) => l !== "");
    return lines.join("\n").trim();
  }

  /** 图像预处理：灰度 + 对比度归一化 + 中值去噪 + 锐化（sharp） */
  private async preprocessImage(imagePath: string): Promise<string> {
    if (!OCR_PREPROCESS) return imagePath;
    try {
      const { default: sharp } = await import("sharp");
      const out = join(tmpdir(), `dfr-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
      await sharp(imagePath)
        .greyscale()
        .normalize()
        .median(1)
        .sharpen()
        .png()
        .toFile(out);
      return out;
    } catch (error) {
      this.logger.warn(`ocr preprocess failed, use original: ${String(error)}`);
      return imagePath;
    }
  }

  private async runTesseract(imagePath: string): Promise<string> {
    const preprocessed = await this.preprocessImage(imagePath);
    try {
      const { stdout } = await execFileAsync(
        "tesseract",
        [
          preprocessed,
          "stdout",
          "-l",
          OCR_LANG,
          "--psm",
          "3",
          "--oem",
          "1",
          "-c",
          "preserve_interword_spaces=1",
        ],
        { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 },
      );
      return this.cleanOcrText(stdout);
    } finally {
      if (preprocessed !== imagePath) {
        try {
          rmSync(preprocessed, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async ocrImage(imagePath: string): Promise<string> {
    return this.runTesseract(imagePath);
  }

  private async ocrPdf(pdfPath: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "dfr-pdf-"));
    try {
      await execFileAsync("pdftoppm", ["-png", "-r", String(OCR_PDF_DPI), pdfPath, join(dir, "p")], {
        timeout: 120_000,
      });
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".png"))
        .sort()
        .slice(0, MAX_OCR_PAGES);
      const parts: string[] = [];
      for (const f of files) {
        const text = await this.runTesseract(join(dir, f)).catch(() => "");
        if (text) parts.push(text);
      }
      return parts.join("\n\n").trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** PDF 文本层提取（pdftotext）：快且准，适合数字生成型 PDF */
  private async extractPdfText(pdfPath: string): Promise<string> {
    const { stdout } = await execFileAsync("pdftotext", [pdfPath, "-"], {
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout.trim();
  }

  /** Error Level Analysis：二次重压缩差异率过高 → 疑似篡改 */
  private async elaCheck(imagePath: string): Promise<AnalysisCheck> {
    try {
      const { default: sharp } = await import("sharp");
      const q95 = await sharp(imagePath).jpeg({ quality: 95 }).toBuffer();
      const q85 = await sharp(q95).jpeg({ quality: 85 }).toBuffer();
      const a = await sharp(q95).raw().toBuffer({ resolveWithObject: true });
      const b = await sharp(q85).raw().toBuffer({ resolveWithObject: true });
      const { data: da, info: ia } = a;
      const { data: db } = b;
      if (da.length !== db.length || ia.channels < 3) {
        return { name: "ela", passed: true, detail: "图像通道异常，跳过 ELA 检测" };
      }
      let diff = 0;
      const step = 8;
      for (let i = 0; i < da.length; i += ia.channels * step) {
        const r = Math.abs(da[i] - db[i]);
        const g = Math.abs(da[i + 1] - db[i + 1]);
        const bl = Math.abs(da[i + 2] - db[i + 2]);
        if (r > 18 || g > 18 || bl > 18) diff++;
      }
      const total = Math.ceil(da.length / (ia.channels * step));
      const ratio = diff / Math.max(1, total);
      if (ratio > 0.05) {
        return {
          name: "ela",
          passed: false,
          detail: `检测到 ${(ratio * 100).toFixed(1)}% 像素存在压缩异常，疑似局部篡改`,
        };
      }
      return { name: "ela", passed: true, detail: "未检测到明显篡改痕迹（压缩一致性正常）" };
    } catch {
      return { name: "ela", passed: true, detail: "ELA 检测不可用，已跳过" };
    }
  }

  /** EXIF：检测是否由图像编辑软件生成/修改 */
  private async exifCheck(imagePath: string): Promise<AnalysisCheck> {
    try {
      const { default: sharp } = await import("sharp");
      const meta = await sharp(imagePath).metadata();
      const exif = (meta.exif as Buffer | undefined)?.toString("latin1") ?? "";
      const markers = ["Adobe Photoshop", "GIMP", "Paint.NET"];
      const edited = markers.filter((m) => exif.includes(m));
      if (edited.length > 0) {
        return {
          name: "exif",
          passed: false,
          detail: `检测到编辑软件痕迹：${edited.join("、")}`,
        };
      }
      return { name: "exif", passed: true, detail: "无图像编辑软件痕迹" };
    } catch {
      return { name: "exif", passed: true, detail: "EXIF 检测不可用，已跳过" };
    }
  }

  private async pdfCheck(pdfPath: string): Promise<AnalysisCheck> {
    try {
      const size = statSync(pdfPath).size;
      const head = await this.readRange(pdfPath, 0, 1024);
      const tail = await this.readRange(pdfPath, Math.max(0, size - 2048), size);
      const okHead = head.slice(0, 5).toString("latin1") === "%PDF-";
      const okTail = tail.toString("latin1").includes("%%EOF");
      if (!okHead || !okTail) {
        return { name: "pdf_structure", passed: false, detail: "PDF 结构异常（头/尾标记不完整）" };
      }
      return { name: "pdf_structure", passed: true, detail: "PDF 结构完整" };
    } catch {
      return { name: "pdf_structure", passed: true, detail: "PDF 结构检测不可用" };
    }
  }

  private readRange(path: string, start: number, end: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = createReadStream(path, { start, end: end - 1 });
      stream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }

  async analyze(
    fileId: string,
    userId: string,
    role: string,
  ): Promise<AnalysisResult> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException("文件不存在");
    // 审计深测：仅上传者本人或管理员可分析文件，防止越权读取 OCR 内容/关键字段。
    if (role !== "ADMIN" && role !== "SUPER_ADMIN" && file.uploaderId !== userId) {
      throw new ForbiddenException("无权分析此文件");
    }
    await this.prisma.file.update({
      where: { id: fileId },
      data: { ocrStatus: "PROCESSING", authStatus: "PROCESSING" },
    });
    let tmpDir: string | null = null;
    try {
      tmpDir = await this.materialize(file.path);
      const tmp = join(tmpDir, "doc.bin");
      const checks: AnalysisCheck[] = [];

      const hash = await this.sha256(tmp);
      checks.push({
        name: "hash_integrity",
        passed: hash === file.hash,
        detail:
          hash === file.hash
            ? "文件哈希与上传记录一致"
            : "文件哈希与上传记录不一致，内容可能被改动",
      });
      if (file.attestedAt && file.txSignature) {
        checks.push({
          name: "onchain_attestation",
          passed: true,
          detail: `已链上存证（${file.txSignature.slice(0, 10)}…，${file.attestedAt.toISOString().slice(0, 10)}）`,
        });
      }

      let ocrText = "";
      let ocrSource: AnalysisResult["ocrSource"] = "none";
      if (file.mimeType.startsWith("image/")) {
        checks.push(await this.elaCheck(tmp));
        checks.push(await this.exifCheck(tmp));
        try {
          ocrText = await this.ocrImage(tmp);
          if (ocrText) ocrSource = "image-ocr";
        } catch (e) {
          this.logger.warn(`ocr failed: ${String(e)}`);
        }
      } else if (file.mimeType === "application/pdf") {
        checks.push(await this.pdfCheck(tmp));
        // PDF 适配：优先提取文本层（pdftotext，快且准确）；无文本层（扫描件）再回退 tesseract OCR
        try {
          const textLayer = await this.extractPdfText(tmp);
          if (textLayer.length >= MIN_PDF_TEXT_CHARS) {
            ocrText = textLayer;
            ocrSource = "pdftotext";
          }
        } catch (e) {
          this.logger.warn(`pdf text layer extraction failed: ${String(e)}`);
        }
        if (!ocrText) {
          try {
            ocrText = await this.ocrPdf(tmp);
            if (ocrText) ocrSource = "tesseract";
          } catch (e) {
            this.logger.warn(`pdf ocr failed: ${String(e)}`);
          }
        }
      } else {
        checks.push({ name: "content", passed: true, detail: "非图片/PDF，跳过视觉与 OCR 检测" });
      }

      let keyFields: KeyFields = {};
      if (ocrText) {
        keyFields = extractKeyFields(ocrText);
        const validations = validateFields(keyFields);
        checks.push(...validations.map((v) => ({ name: v.name, passed: v.passed, detail: v.detail })));
      }

      const passed = checks.filter((c) => c.passed).length;
      const score = Math.round((passed / checks.length) * 100);
      const verdict: AnalysisResult["verdict"] =
        score >= 80 ? "LOW_RISK" : score >= 55 ? "MEDIUM_RISK" : "HIGH_RISK";

      const result = {
        score,
        verdict,
        checks,
        keyFields,
        validations: validateFields(keyFields),
        ocrSource,
      } as unknown as Prisma.InputJsonValue;
      await this.prisma.file.update({
        where: { id: fileId },
        data: {
          ocrStatus: ocrText ? "SUCCESS" : "FAILED",
          ocrText: ocrText || null,
          ocrLang: ocrText ? OCR_LANG : null,
          authStatus: "SUCCESS",
          authScore: score,
          authResult: result,
          analyzedAt: new Date(),
        },
      });
      await this.audit.record({
        actorId: file.uploaderId ?? undefined,
        action: "FILE_ANALYZED",
        targetType: "FILE",
        targetId: fileId,
        metadata: { score, verdict, ocrChars: ocrText.length, ocrSource },
      });
      return {
        score,
        verdict,
        checks,
        ocrText,
        ocrSource,
        keyFields,
        validations: validateFields(keyFields),
      };
    } catch (error) {
      this.logger.error(`analyze failed: ${String(error)}`);
      await this.prisma.file.update({
        where: { id: fileId },
        data: { ocrStatus: "FAILED", authStatus: "FAILED" },
      });
      throw error;
    } finally {
      if (tmpDir) {
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }
  }
}
