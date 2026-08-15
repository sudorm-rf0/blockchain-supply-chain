import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CleanupUploadedFilesInterceptor } from "../shared/cleanup-uploaded-files.interceptor";
import { diskStorage } from "multer";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response } from "express";
import { AuthGuard } from "@supply-chain/common";
import { AdminGuard } from "@supply-chain/common";
import { FilesService } from "./files.service";
import { FilesAnalysisService } from "./files-analysis.service";
import { FilesTranslationService } from "./files-translation.service";
import { FilesAiService } from "./files-ai.service";
import { decodeFilename } from "./filename";
import { ReviewFileDto } from "./dto/review-file.dto";
import { BatchReviewDto } from "./dto/batch-review.dto";
import { UploadFileDto } from "./dto/upload-file.dto";
import { AiChatDto } from "./dto/ai-chat.dto";
import type { FileStatus } from "@prisma/client";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const UPLOAD_DIR = join(process.cwd(), "uploads");

const storage = diskStorage({
  destination: (_req, _file, cb) => {
    mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const decoded = decodeFilename(file.originalname);
    const safeName = decoded.replace(/[^\w.-]/g, "_");
    cb(null, `${Date.now()}_${randomUUID()}_${safeName}`);
  },
});

@Controller("api/files")
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly analysisService: FilesAnalysisService,
    private readonly translationService: FilesTranslationService,
    private readonly aiService: FilesAiService,
  ) {}

  @Post()
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor("file", {
      storage,
      limits: { fileSize: MAX_FILE_SIZE },
    }),
    CleanupUploadedFilesInterceptor,
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadFileDto,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException("未上传文件");
    }
    const region =
      typeof req.headers["cf-ipcountry"] === "string"
        ? req.headers["cf-ipcountry"].toUpperCase()
        : undefined;
    return this.filesService.upload(file, body, req.user!.sub, region);
  }

  /** 运行 OCR 与真伪分析（上传时已自动触发；失败或需要重跑时手动调用） */
  @Post(":id/analyze")
  @UseGuards(AuthGuard)
  analyze(@Param("id") id: string, @Req() req: Request) {
    // 审计深测：analyze 必须校验归属，防止任意登录用户对他人文件触发 OCR/内容分析（信息泄露+资源滥用）
    return this.analysisService.analyze(id, req.user!.sub, req.user!.role);
  }

  /** AI 审核助手：生成单据 AI 审核报告（摘要 + 风险评估 + 建议） */
  @Post(":id/ai/review")
  @UseGuards(AuthGuard)
  aiReview(@Param("id") id: string, @Req() req: Request) {
    return this.aiService.review(id, req.user!.sub, req.user!.role);
  }

  /** AI 审核助手：基于单据上下文对话问答 */
  @Post(":id/ai/chat")
  @UseGuards(AuthGuard)
  aiChat(@Param("id") id: string, @Body() body: AiChatDto, @Req() req: Request) {
    return this.aiService.chat(id, req.user!.sub, req.user!.role, body);
  }

  /** 翻译文档（基于 OCR 文本），targetLang: en | zh-CN | zh-TW */
  @Post(":id/translate")
  @UseGuards(AuthGuard)
  translate(@Param("id") id: string, @Body() body: { targetLang: string }, @Req() req: Request) {
    const lang = (body.targetLang as "en" | "zh-CN" | "zh-TW") ?? "en";
    if (!["en", "zh-CN", "zh-TW"].includes(lang)) {
      throw new BadRequestException("不支持的目标语言");
    }
    return this.translationService.translate(id, lang, req.user!.sub);
  }

  /** 管理员验证翻译：action approve | reject */
  @Post(":id/translation/:lang/verify")
  @UseGuards(AuthGuard, AdminGuard)
  verifyTranslation(
    @Param("id") id: string,
    @Param("lang") lang: string,
    @Body() body: { action: "approve" | "reject" },
    @Req() req: Request,
  ) {
    if (!["en", "zh-CN", "zh-TW"].includes(lang)) {
      throw new BadRequestException("不支持的语言");
    }
    const action = body.action === "reject" ? "reject" : "approve";
    return this.translationService.verify(id, lang as "en" | "zh-CN" | "zh-TW", action, req.user!.sub);
  }

  @Get()
  @UseGuards(AuthGuard)
  list(
    @Query("page") page = "1",
    @Query("limit") limit = "10",
    @Query("status") status?: string,
    @Query("tradeId") tradeId?: string,
    @Req() req?: Request,
  ) {
    return this.filesService.list({
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(100, Math.max(1, Number(limit) || 10)),
      status: status as FileStatus | undefined,
      userId: req!.user!.role !== "USER" ? undefined : req!.user!.sub,
      tradeId: tradeId || undefined,
    });
  }

  @Get(":id")
  @UseGuards(AuthGuard)
  getOne(@Param("id") id: string, @Req() req: Request) {
    return this.filesService.getOne(id, req.user!.sub, req.user!.role);
  }

  @Get(":id/versions")
  @UseGuards(AuthGuard)
  versions(@Param("id") id: string, @Req() req: Request) {
    return this.filesService.getVersions(id, req.user!.sub, req.user!.role);
  }

  @Get(":id/content")
  @UseGuards(AuthGuard)
  async content(
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.filesService.getContent(
      id,
      req.user!.sub,
      req.user!.role,
    );
    const encodedName = encodeURIComponent(file.filename);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
    );
    // 审计 L1：上传内容以 sandbox 渲染，禁用脚本/同源访问，杜绝存储型 XSS/钓鱼。
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("Cache-Control", "private, max-age=3600");
    file.stream.on("error", () => {
      if (!res.headersSent) {
        res.status(500).end();
      }
    });
    file.stream.pipe(res);
  }

  @Patch(":id")
  @UseGuards(AuthGuard, AdminGuard)
  patch(
    @Param("id") id: string,
    @Body() body: ReviewFileDto,
    @Req() req: Request,
  ) {
    return this.filesService.patch(id, body, {
      id: req.user!.sub,
      email: req.user!.email,
    });
  }

  @Post("batch-review")
  @UseGuards(AuthGuard, AdminGuard)
  batchReview(
    @Body() body: BatchReviewDto,
    @Req() req: Request,
  ) {
    return this.filesService.batchReview(body.ids, body, {
      id: req.user!.sub,
      email: req.user!.email,
    });
  }

  @Delete(":id")
  @UseGuards(AuthGuard)
  remove(
    @Param("id") id: string,
    @Query("confirm") confirm: string,
    @Req() req: Request,
  ) {
    return this.filesService.remove(
      id,
      req.user!.sub,
      req.user!.role,
      confirm,
    );
  }
}
