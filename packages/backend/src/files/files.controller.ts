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
import { diskStorage } from "multer";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { AdminGuard } from "../auth/admin.guard";
import { FilesService } from "./files.service";
import { ReviewFileDto } from "./dto/review-file.dto";
import { BatchReviewDto } from "./dto/batch-review.dto";
import { UploadFileDto } from "./dto/upload-file.dto";
import type { FileStatus } from "@prisma/client";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const UPLOAD_DIR = join(process.cwd(), "uploads");

const storage = diskStorage({
  destination: (_req, _file, cb) => {
    mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^\w.\-]/g, "_");
    cb(null, `${Date.now()}_${randomUUID()}_${safeName}`);
  },
});

@Controller("api/files")
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor("file", {
      storage,
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadFileDto,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException("未上传文件");
    }
    return this.filesService.upload(file, body, req.user!.sub);
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
      userId: req!.user!.role === "ADMIN" ? undefined : req!.user!.sub,
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
