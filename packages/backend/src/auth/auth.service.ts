import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { signJwt } from "./jwt";

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
      throw new UnauthorizedException("缺少注册字段");
    }
    const existing = await this.prisma.user.findUnique({
      where: { email: body.email },
    });
    if (existing) {
      throw new ConflictException("邮箱已被注册");
    }
    const wallet = body.wallet || body.email;
    const user = await this.prisma.user.create({
      data: {
        wallet,
        email: body.email,
        name: body.name,
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
    const hash = scryptSync(body.password, salt, 64);
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
