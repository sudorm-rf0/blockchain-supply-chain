import { BadRequestException, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

/** 邀请码字符集：去除易混淆的 0/O/1/I/l，仍为数字+大小写字母混合。 */
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 6;
const MAX_GENERATE = 500;

export interface InviteCodeRecord {
  id: string;
  code: string;
  usedAt: Date | null;
  usedByEmail: string | null;
  usedByName: string | null;
  usedByRole: string | null;
  createdAt: Date;
}

@Injectable()
export class InviteCodesService {
  constructor(private readonly prisma: PrismaService) {}

  private randomChar(): string {
    const buf = randomBytes(1);
    return CHARSET[buf[0] % CHARSET.length];
  }

  /** 生成一个 6 位邀请码：保证至少含 1 个数字与 1 个字母。 */
  private randomCode(): string {
    const chars: string[] = [];
    // 随机放一个数字位置与一个字母位置，其余随机，保证"数字+字母混合"
    const numIdx = Math.floor(Math.random() * CODE_LENGTH);
    const letterIdx = (numIdx + 1 + Math.floor(Math.random() * (CODE_LENGTH - 1))) % CODE_LENGTH;
    for (let i = 0; i < CODE_LENGTH; i++) {
      if (i === numIdx) {
        chars.push(String(Math.floor(Math.random() * 10)));
      } else if (i === letterIdx) {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        chars.push(letters[Math.floor(Math.random() * letters.length)]);
      } else {
        chars.push(this.randomChar());
      }
    }
    return chars.join("");
  }

  async generate(count: number, createdById: string): Promise<string[]> {
    if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATE) {
      throw new BadRequestException(`邀请码数量需为 1-${MAX_GENERATE} 的整数`);
    }
    const codes: string[] = [];
    const seen = new Set<string>();
    let attempts = 0;
    while (codes.length < count && attempts < count * 50) {
      attempts += 1;
      const code = this.randomCode();
      if (seen.has(code)) continue;
      const existing = await this.prisma.inviteCode.findUnique({
        where: { code },
        select: { id: true },
      });
      if (existing) continue;
      seen.add(code);
      codes.push(code);
    }
    if (codes.length < count) {
      throw new BadRequestException("生成邀请码失败，请重试");
    }
    await this.prisma.inviteCode.createMany({
      data: codes.map((code) => ({ code, createdById })),
    });
    return codes;
  }

  async list(): Promise<InviteCodeRecord[]> {
    const rows = await this.prisma.inviteCode.findMany({
      orderBy: { createdAt: "desc" },
      take: 2000,
      include: {
        usedBy: { select: { email: true, name: true, role: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      usedAt: row.usedAt,
      usedByEmail: row.usedBy?.email ?? null,
      usedByName: row.usedBy?.name ?? null,
      usedByRole: row.usedBy?.role ?? null,
      createdAt: row.createdAt,
    }));
  }

}
