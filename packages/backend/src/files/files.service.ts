import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { FileStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, unlinkSync } from "node:fs";
import { open } from "node:fs/promises";
import { extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";

const ALLOWED_EXTENSIONS: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const EXTENSION_TO_MAGIC: Record<string, string> = {
  pdf: "pdf",
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  doc: "doc",
  docx: "docx",
};

const MAGIC_BYTES: Record<string, number[]> = {
  pdf: [0x25, 0x50, 0x44, 0x46],          // %PDF
  png: [0x89, 0x50, 0x4e, 0x47],          // .PNG
  jpeg: [0xff, 0xd8, 0xff],               // ÿØÿ
  docx: [0x50, 0x4b, 0x03, 0x04],         // PK..
  doc: [0xd0, 0xcf, 0x11, 0xe0],          // OLE2
};

const VALID_STATUS_FILTERS = new Set([
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

function detectTypeByMagic(buf: Buffer): string | null {
  for (const [type, magic] of Object.entries(MAGIC_BYTES)) {
    if (magic.every((b, i) => buf[i] === b)) return type;
  }
  return null;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject("STORAGE_SERVICE") private readonly storage: StorageService,
  ) {}

  async upload(
    file: Express.Multer.File,
    fields: { tradeId?: string; description?: string },
    uploaderId: string,
  ) {
    const extension = extname(file.originalname).slice(1).toLowerCase();
    if (!ALLOWED_EXTENSIONS[extension]) {
      this.removeUploadedFile(file.path);
      throw new ForbiddenException("不支持的文件扩展名");
    }

    const header = Buffer.alloc(8);
    const handle = await open(file.path, "r");
    try {
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
    const magicType = detectTypeByMagic(header);
    if (!magicType || EXTENSION_TO_MAGIC[extension] !== magicType) {
      this.removeUploadedFile(file.path);
      throw new ForbiddenException("文件内容与扩展名不匹配");
    }

    const hash = createHash("sha256");
    await pipeline(createReadStream(file.path), hash);
    const fileHash = hash.digest("hex");
    let persisted;
    try {
      persisted = await this.storage.persist(file.path, file.originalname);
    } catch (error) {
      this.removeUploadedFile(file.path);
      throw error;
    }

    try {
      return await this.prisma.file.create({
        data: {
          filename: file.originalname,
          size: persisted.size || file.size,
          mimeType: ALLOWED_EXTENSIONS[extension],
          path: persisted.storageKey,
          hash: fileHash,
          tradeId: fields.tradeId ?? null,
          description: fields.description ?? null,
          uploaderId,
        },
        include: { uploader: true },
      });
    } catch (error) {
      await this.storage.remove(persisted.storageKey).catch(() => undefined);
      throw error;
    }
  }

  async list(params: {
    page: number;
    limit: number;
    status?: FileStatus;
    userId?: string;
  }) {
    const where: Prisma.FileWhereInput = {};
    if (params.status) {
      if (!VALID_STATUS_FILTERS.has(params.status)) {
        throw new BadRequestException("invalid status filter");
      }
      where.status = params.status;
    }
    if (params.userId) where.uploaderId = params.userId;

    const [items, total] = await Promise.all([
      this.prisma.file.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: { uploader: true },
      }),
      this.prisma.file.count({ where }),
    ]);
    return {
      items: items.map((file) => this.publicFile(file)),
      total,
      page: params.page,
      limit: params.limit,
    };
  }

  async getOne(id: string, userId: string, role: string) {
    const file = await this.prisma.file.findUnique({
      where: { id },
      include: { uploader: true },
    });
    if (!file) throw new NotFoundException("文件不存在");
    if (role !== "ADMIN" && file.uploaderId !== userId) {
      throw new ForbiddenException("无权查看此文件");
    }
    return this.publicFile(file);
  }

  async getContent(id: string, userId: string, role: string) {
    const file = await this.prisma.file.findUnique({ where: { id } });
    if (!file) throw new NotFoundException("文件不存在");
    if (role !== "ADMIN" && file.uploaderId !== userId) {
      throw new ForbiddenException("无权查看此文件");
    }
    let stream;
    try {
      stream = await this.storage.open(file.path);
    } catch {
      throw new NotFoundException("文件已丢失");
    }
    return {
      stream,
      filename: file.filename,
      mimeType: file.mimeType,
    };
  }

  async patch(
    id: string,
    body: { status?: "APPROVED" | "REJECTED"; remark?: string },
  ) {
    const file = await this.prisma.file.findUnique({ where: { id } });
    if (!file) throw new NotFoundException("文件不存在");
    const updated = await this.prisma.file.update({
      where: { id },
      data: {
        status: body.status ?? file.status,
        remark: body.remark ?? file.remark,
      },
      include: { uploader: true },
    });
    return this.publicFile(updated);
  }

  async remove(id: string, userId: string, role: string) {
    const file = await this.prisma.file.findUnique({ where: { id } });
    if (!file) throw new NotFoundException("文件不存在");
    if (role !== "ADMIN" && file.uploaderId !== userId) {
      throw new ForbiddenException("无权删除此文件");
    }
    await this.storage.remove(file.path);
    await this.prisma.file.delete({ where: { id } });
    return { ok: true };
  }

  private removeUploadedFile(path: string) {
    if (path && existsSync(path)) unlinkSync(path);
  }

  private publicFile(file: {
    id: string;
    filename: string;
    size: number;
    mimeType: string;
    path: string;
    hash: string;
    txSignature: string | null;
    documentPda: string | null;
    attestedAt: Date | null;
    status: string;
    tradeId: string | null;
    description: string | null;
    remark: string | null;
    createdAt: Date;
    uploader?: { name: string | null } | null;
  }) {
    return {
      id: file.id,
      filename: file.filename,
      size: file.size,
      mimeType: file.mimeType,
      path: file.path,
      hash: file.hash,
      txSignature: file.txSignature,
      documentPda: file.documentPda,
      attestedAt: file.attestedAt?.toISOString() ?? null,
      status: file.status,
      tradeId: file.tradeId,
      description: file.description,
      remark: file.remark,
      uploaderName: file.uploader?.name ?? null,
      createdAt: file.createdAt.toISOString(),
    };
  }
}
