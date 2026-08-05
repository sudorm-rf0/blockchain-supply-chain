import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PublicKey } from "@solana/web3.js";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "@supply-chain/common";
import { AuditService } from "../audit/audit.service";
import { signJwt } from "@supply-chain/common";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./session";
import { invalidateUserState } from "@supply-chain/common";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

async function hashPassword(password: string, salt: string): Promise<Buffer> {
  return scryptAsync(password, salt, 64);
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  wallet: string;
  mustChangePassword: boolean;
}

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
  mustChangePassword: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async register(body: {
    name: string;
    email: string;
    password: string;
    wallet?: string;
  }): Promise<SessionResult> {
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
    if (body.wallet) {
      const walletOwner = await this.prisma.user.findUnique({
        where: { wallet: body.wallet },
        select: { id: true },
      });
      if (walletOwner) {
        throw new ConflictException("该钱包地址已被其他用户绑定");
      }
    }
    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await hashPassword(body.password, salt)).toString("hex");
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          wallet,
          email: body.email,
          name: body.name,
          passwordHash: `${salt}:${passwordHash}`,
          role: "USER",
        },
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        throw new ConflictException("该钱包地址或邮箱已被其他用户绑定");
      }
      throw error;
    }
    await this.audit.record({
      actorId: user.id,
      action: "AUTH_REGISTER",
      targetType: "AUTH",
      targetId: user.id,
      metadata: { email: body.email },
    });
    return this.issueSession(user);
  }

  async login(
    body: { email: string; password: string },
    clientIp?: string,
  ): Promise<SessionResult> {
    const failKey = `login:fail:${body.email}`;
    const fails = await this.redis.incr(failKey);
    if (fails === 1) {
      await this.redis.expire(failKey, 15 * 60);
    }
    const ipKey = clientIp ? `login:fail:ip:${clientIp}` : null;
    let ipFails = 0;
    if (ipKey) {
      ipFails = await this.redis.incr(ipKey);
      if (ipFails === 1) {
        await this.redis.expire(ipKey, 15 * 60);
      }
    }
    if (fails >= 5 || (ipKey && ipFails >= 20)) {
      throw new HttpException(
        "尝试次数过多，请 15 分钟后再试",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

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
    await this.redis.del(failKey);
    await this.audit.record({
      actorId: user.id,
      action: "AUTH_LOGIN",
      targetType: "AUTH",
      targetId: user.id,
      metadata: { clientIp: clientIp ?? null },
    });
    return this.issueSession(user);
  }

  async refresh(rawRefreshToken: string): Promise<SessionResult> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException("登录已过期");
    }
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (
      !record ||
      record.revokedAt ||
      record.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException("登录已过期");
    }
    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
    });
    if (!user) {
      throw new UnauthorizedException("用户不存在");
    }
    if (record.replacedByTokenHash) {
      // A replaced refresh token being reused usually means it was stolen.
      await this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException("检测到令牌重用，请重新登录");
    }

    const nextRefreshToken = generateRefreshToken();
    const nextHash = hashRefreshToken(nextRefreshToken);
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: {
        revokedAt: new Date(),
        replacedByTokenHash: nextHash,
      },
    });
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: nextHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });
    await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    });
    return this.issueSession(user, nextRefreshToken);
  }

  async logout(rawRefreshToken: string): Promise<{ ok: true }> {
    if (rawRefreshToken) {
      const tokenHash = hashRefreshToken(rawRefreshToken);
      const record = await this.prisma.refreshToken.findUnique({
        where: { tokenHash },
        select: { userId: true },
      });
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        actorId: record?.userId ?? null,
        action: "AUTH_LOGOUT",
        targetType: "AUTH",
        targetId: record?.userId ?? "anonymous",
      });
    }
    return { ok: true };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentRefreshToken?: string,
  ): Promise<PublicUser> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException("新密码至少 8 位");
    }
    if (newPassword === currentPassword) {
      throw new BadRequestException("新密码不能与当前密码相同");
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) {
      throw new UnauthorizedException("用户不存在");
    }
    const [salt, storedHash] = user.passwordHash.split(":");
    const hash = await hashPassword(currentPassword, salt);
    const stored = Buffer.from(storedHash, "hex");
    if (hash.length !== stored.length || !timingSafeEqual(hash, stored)) {
      throw new BadRequestException("当前密码不正确");
    }
    const nextSalt = randomBytes(16).toString("hex");
    const nextHash = (await hashPassword(newPassword, nextSalt)).toString("hex");
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: `${nextSalt}:${nextHash}`,
        mustChangePassword: false,
        lastPasswordChangeAt: new Date(),
      },
    });
    invalidateUserState(userId);
    if (currentRefreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          tokenHash: { not: hashRefreshToken(currentRefreshToken) },
        },
        data: { revokedAt: new Date() },
      });
    } else {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.record({
      actorId: userId,
      action: "AUTH_PASSWORD_CHANGED",
      targetType: "AUTH",
      targetId: userId,
    });
    return this.publicUser(updated);
  }

  async getMe(userId: string): Promise<{
    user: PublicUser;
    mustChangePassword: boolean;
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException("用户不存在");
    }
    const publicUser = this.publicUser(user);
    return { user: publicUser, mustChangePassword: publicUser.mustChangePassword };
  }

  async bindWallet(userId: string, wallet: string) {
    const existing = await this.prisma.user.findUnique({
      where: { wallet },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException("该钱包地址已被其他用户绑定");
    }
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { wallet },
      });
      await this.audit.record({
        actorId: userId,
        action: "WALLET_BOUND",
        targetType: "AUTH",
        targetId: userId,
        metadata: { wallet },
      });
      return this.publicUser(user);
    } catch (error: any) {
      if (error?.code === "P2002") {
        throw new ConflictException("该钱包地址已被其他用户绑定");
      }
      throw error;
    }
  }

  private async issueSession(
    user: { id: string; email: string | null; name: string | null; role: string; wallet?: string | null; mustChangePassword?: boolean },
    existingRefreshToken?: string,
  ): Promise<SessionResult> {
    const refreshToken = existingRefreshToken ?? generateRefreshToken();
    if (!existingRefreshToken) {
      await this.prisma.refreshToken.create({
        data: {
          tokenHash: hashRefreshToken(refreshToken),
          userId: user.id,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
        },
      });
    }
    const payload = {
      sub: user.id,
      email: user.email ?? "",
      name: user.name ?? "",
      role: user.role === "ADMIN" ? ("ADMIN" as const) : ("USER" as const),
    };
    const publicUser = this.publicUser(user);
    return {
      accessToken: signJwt(payload, ACCESS_TOKEN_TTL_SECONDS),
      refreshToken,
      user: publicUser,
      mustChangePassword: publicUser.mustChangePassword,
    };
  }

  private publicUser(user: {
    id: string;
    email: string | null;
    name: string | null;
    role: string;
    wallet?: string | null;
    mustChangePassword?: boolean;
  }): PublicUser {
    return {
      id: user.id,
      email: user.email ?? "",
      name: user.name ?? "",
      role: user.role === "ADMIN" ? ("ADMIN" as const) : ("USER" as const),
      wallet: user.wallet ?? "",
      mustChangePassword: user.mustChangePassword === true,
    };
  }
}
