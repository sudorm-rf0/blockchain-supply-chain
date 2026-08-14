import { Controller, Get, Query } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "../prisma/prisma.service";

/**
 * 公开核验接口：按文件哈希查询单据存证信息（无需登录，用于扫码/链接核验）。
 */
@SkipThrottle()
@Controller("api/public")
export class PublicVerifyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("verify")
  async verify(@Query("hash") hash?: string) {
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
      return { ok: false, error: "invalid hash" };
    }
    const file = await this.prisma.file.findFirst({
      where: { hash: hash.toLowerCase() },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        filename: true,
        hash: true,
        status: true,
        createdAt: true,
        analyzedAt: true,
        authScore: true,
        authResult: true,
        attestedAt: true,
        txSignature: true,
        documentPda: true,
        uploader: { select: { name: true } },
      },
    });
    if (!file) {
      return { ok: false, error: "not found" };
    }
    return {
      ok: true,
      file: {
        ...file,
        createdAt: file.createdAt.toISOString(),
        analyzedAt: file.analyzedAt?.toISOString() ?? null,
        attestedAt: file.attestedAt?.toISOString() ?? null,
        uploaderName: file.uploader?.name ?? null,
        uploader: undefined,
      },
    };
  }
}
