import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PublicKey } from "@solana/web3.js";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { PrismaService } from "../prisma/prisma.service";
import { signJwt } from "./jwt";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

async function hashPassword(password: string, salt: string): Promise<Buffer> {
  return scryptAsync(password, salt, 64);
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(body: {
    name: string;
    email: string;
    password: string;
    wallet?: string;
  }) {
    if (!body.name || !body.email || !body.password) {
      throw new BadRequestException("缺少注册字段");
    }
    if (body.password.length < 6) {
      throw new BadRequestException("密码至少 6 位");
    }
    if (body.wallet) {
      try {
        new PublicKey(body.wallet);
      } catch {
        throw new BadRequestException("Solana 钱包地址格式不正确");
      }
    }
    const existing = await this.prisma.user.findUnique({
      where: { email: body.email },
    });
    if (existing) {
      throw new ConflictException("邮箱已被注册");
    }
    const wallet = body.wallet || body.email;
    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await hashPassword(body.password, salt)).toString("hex");
    const user = await this.prisma.user.create({
      data: {
        wallet,
        email: body.email,
        name: body.name,
        passwordHash: `${salt}:${passwordHash}`,
        role: "USER",
      },
    });
    const token = signJwt({
      sub: user.id,
      email: user.email ?? "",
      name: user.name ?? "",
      role: "USER",
    });
    return { token, user: this.publicUser(user) };
  }

  async login(body: { email: string; password: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
    });
    if (!user?.passwordHash) {
      throw new UnauthorizedException("邮箱或密码错误");
    }
    const [salt, storedHash] = user.passwordHash.split(":");
    const hash = await hashPassword(body.password, salt);
    const stored = Buffer.from(storedHash, "hex");
    if (hash.length !== stored.length || !timingSafeEqual(hash, stored)) {
      throw new UnauthorizedException("邮箱或密码错误");
    }
    const token = signJwt({
      sub: user.id,
      email: user.email ?? "",
      name: user.name ?? "",
      role: user.role === "ADMIN" ? "ADMIN" : "USER",
    });
    return { token, user: this.publicUser(user) };
  }

  async bindWallet(userId: string, wallet: string) {
    const existing = await this.prisma.user.findUnique({
      where: { wallet },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException("该钱包地址已被其他用户绑定");
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { wallet },
    });
    return this.publicUser(user);
  }

  private publicUser(user: {
    id: string;
    email: string | null;
    name: string | null;
    role: string;
    wallet?: string | null;
  }) {
    return {
      id: user.id,
      email: user.email ?? "",
      name: user.name ?? "",
      role: user.role === "ADMIN" ? ("ADMIN" as const) : ("USER" as const),
      wallet: user.wallet ?? "",
    };
  }
}
