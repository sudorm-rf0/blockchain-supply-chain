import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { PublicKey } from "@solana/web3.js";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { promisify } from "node:util";
import { PrismaService } from "../prisma/prisma.service";
import { getRedisFailureCount, RedisService } from "@supply-chain/common";
import { AuditService } from "../audit/audit.service";
import { TurnstileService } from "./turnstile.service";
import { EmailVerificationService } from "../email-verification/email-verification.service";
import { signJwt } from "@supply-chain/common";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./session";
import { invalidateUserState } from "@supply-chain/common";
import { captureException } from "../shared/sentry";
import { createHmac } from "node:crypto";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

async function hashPassword(password: string, salt: string): Promise<Buffer> {
  return scryptAsync(password, salt, 64);
}

// ---- TOTP：RFC 6238，node:crypto 原生实现（零依赖，避免 otplib 打包问题）----
const TOTP_ISSUER = "SupplyChain";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCodeAt(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return (bin % 1_000_000).toString().padStart(6, "0");
}

function isValidTotpCode(code: string, secret: string | null): boolean {
  if (!/^\d{6}$/.test(code) || !secret) return false;
  try {
    const counter = Math.floor(Date.now() / 1000 / 30);
    for (let i = -1; i <= 1; i++) {
      if (totpCodeAt(secret, counter + i) === code) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function totpUri(secret: string, accountName: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${accountName}`);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(TOTP_ISSUER)}&algorithm=SHA1&digits=6&period=30`;
}

function totpEncryptionKey(): Buffer {
  // 启动期已由 validateStartupEnv 强制 JWT_SECRET（>= 32 字符），此处不再允许任何
  // dev 固定值兜底（OFF-AUTH-1）：缺失时直接失败，而不是用弱密钥加密 TOTP。
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set (>= 32 chars) before TOTP encryption");
  }
  return createHash("sha256").update(`${secret}:totp`).digest();
}

function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", totpEncryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

function decryptTotpSecret(stored: string | null): string | null {
  if (!stored) return null;
  try {
    const [ivB64, tagB64, encB64] = stored.split(".");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      totpEncryptionKey(),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN" | "SUPER_ADMIN";
  wallet: string;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  emailOtpEnabled: boolean;
  emailVerified: boolean;
}

/** 注册结果：创建成功但需先完成邮箱验证后才能登录 */
export interface RegisterResult {
  requiresEmailVerification: true;
  expiresIn: number;
  cooldownSeconds: number;
  user: PublicUser;
  /** 仅开发环境且未配置邮件服务时返回，便于本地联调 */
  devCode?: string;
}

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
  mustChangePassword: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly turnstile: TurnstileService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  async register(body: {
    name: string;
    email: string;
    password: string;
    wallet?: string;
    inviteCode: string;
    turnstileToken?: string;
  }): Promise<RegisterResult> {
    if (!(await this.turnstile.verify(body.turnstileToken, { expectedAction: "signup" }))) {
      throw new BadRequestException("人机验证未通过，请重试");
    }
    if (!body.name || !body.email || !body.password) {
      throw new BadRequestException("缺少注册字段");
    }
    if (body.password.length < 6) {
      throw new BadRequestException("密码至少 6 位");
    }
    if (!body.inviteCode || !/^[A-Za-z0-9]{6}$/.test(body.inviteCode)) {
      throw new BadRequestException("邀请码为 6 位数字或字母");
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

    // 防垃圾注册：先发送验证码（失败则不创建账号），账号创建后为未验证状态，
    // 输入验证码激活前不可登录。验证码 5 分钟有效、单次使用。
    const sent = await this.emailVerification.sendCode(body.email);

    // 邀请码校验：必须存在且未被使用
    const invite = await this.prisma.inviteCode.findUnique({
      where: { code: body.inviteCode },
      select: { id: true, usedAt: true },
    });
    if (!invite) {
      throw new BadRequestException("邀请码无效");
    }
    if (invite.usedAt) {
      throw new ConflictException("邀请码已被使用");
    }

    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await hashPassword(body.password, salt)).toString("hex");
    let user;
    try {
      // 事务：创建用户 + 原子占用邀请码（User.inviteCodeId 唯一约束防并发占用）
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            wallet,
            email: body.email,
            name: body.name,
            passwordHash: `${salt}:${passwordHash}`,
            role: "USER",
            emailVerified: false,
            // 最高安全：真实注册账号强制开启邮箱验证码登录
            emailOtpEnabled: true,
            inviteCodeId: invite.id,
          },
        });
        await tx.inviteCode.update({
          where: { id: invite.id },
          data: { usedById: created.id, usedAt: new Date() },
        });
        return created;
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        throw new ConflictException("该钱包地址、邮箱或邀请码已被使用");
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
    return {
      requiresEmailVerification: true,
      expiresIn: sent.expiresIn,
      cooldownSeconds: sent.cooldownSeconds,
      ...(sent.devCode ? { devCode: sent.devCode } : {}),
      user: this.publicUser(user),
    };
  }

  /** 注册邮箱验证：校验验证码并把账号标记为已验证（激活）。 */
  async verifyEmail(
    email: string,
    code: string,
  ): Promise<{ ok: true; email: string }> {
    const normalized = email.trim().toLowerCase();
    await this.emailVerification.verifyCode(email, code);
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (!user) {
      throw new BadRequestException("用户不存在");
    }
    if (user.emailVerified) {
      return { ok: true, email: normalized };
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });
    await this.audit.record({
      actorId: updated.id,
      actorEmail: updated.email,
      action: "EMAIL_VERIFIED",
      targetType: "AUTH",
      targetId: updated.id,
    });
    return { ok: true, email: normalized };
  }

  async login(
    body: {
      email: string;
      password: string;
      totpCode?: string;
      emailOtpCode?: string;
      turnstileToken?: string;
    },
    clientIp?: string,
  ): Promise<
    | SessionResult
    | { requiresTotp: true }
    | { requiresEmailOtp: true; devCode?: string }
  > {
    if (!(await this.turnstile.verify(body.turnstileToken, { remoteIp: clientIp, expectedAction: "login" }))) {
      throw new BadRequestException("人机验证未通过，请重试");
    }
    const redisFailuresBefore = getRedisFailureCount();
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
    if (getRedisFailureCount() > redisFailuresBefore) {
      // OFF-REDIS-1：Redis 不可用时防暴破计数 fail-open，禁止静默降级。
      this.logger.error(
        "REDIS_DEGRADED: login rate-limit counters failed (fail-open). " +
          "Redis unavailable or unreachable; brute-force protection is degraded.",
      );
      captureException(
        new Error("REDIS_DEGRADED: login rate-limit fail-open (Redis unavailable)"),
      );
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
    if (user.deletedAt) {
      throw new UnauthorizedException("账号已注销，无法登录");
    }
    if (user.emailVerified === false) {
      throw new ForbiddenException("邮箱尚未验证，请先完成邮箱验证后登录");
    }
    if (user.emailOtpEnabled) {
      if (!user.email) {
        throw new BadRequestException("该账号未绑定邮箱，无法使用邮箱验证");
      }
      // 「邮箱OTP + TOTP」双验证修复：邮箱验证码单次有效（verifyCode 成功后即作废），
      // 若同时开启 TOTP，第三步带 TOTP 的提交会再次校验已作废的邮箱验证码而永远失败。
      // 因此在邮箱验证通过后写入一个 10 分钟一次性标记，后续提交跳过邮箱验证直接校验 TOTP。
      const emailVerifiedKey = `login:email-verified:${createHash("sha256")
        .update(user.email.trim().toLowerCase())
        .digest("hex")}`;
      let emailAlreadyVerified = false;
      try {
        emailAlreadyVerified = (await this.redis.get(emailVerifiedKey)) === "1";
      } catch {
        // Redis 异常时视为未验证，回退到原流程（不额外阻断登录）
      }
      if (body.emailOtpCode && !emailAlreadyVerified) {
        await this.emailVerification.verifyCode(user.email, body.emailOtpCode);
        try {
          await this.redis.setEx(emailVerifiedKey, 10 * 60, "1");
        } catch (error) {
          this.logger.warn(
            `login email-verified flag set failed: ${String(error)}`,
          );
        }
      } else if (!body.emailOtpCode && !emailAlreadyVerified) {
        // 首次提交：向邮箱发送验证码并提示输入（冷却期内不重复发送）
        try {
          const sent = await this.emailVerification.sendCode(user.email);
          // 仅开发环境（未配置邮件服务）返回 devCode，便于本地联调与 e2e
          return {
            requiresEmailOtp: true,
            ...(sent.devCode ? { devCode: sent.devCode } : {}),
          };
        } catch (error) {
          // 60s 冷却 / 小时上限等场景：已有验证码在途，继续要求输入
          this.logger.warn(`email otp send skipped: ${String(error)}`);
          return { requiresEmailOtp: true };
        }
      }
      // emailAlreadyVerified === true：邮箱已验证，跳过，继续后续（TOTP 等）步骤
    }
    if (user.totpEnabled) {
      const secret = decryptTotpSecret(user.totpSecret);
      if (!body.totpCode) {
        return { requiresTotp: true };
      }
      if (!isValidTotpCode(body.totpCode, secret)) {
        throw new UnauthorizedException("TOTP 验证码错误");
      }
    }
    await this.redis.del(failKey);
    // 审计 M5：登录成功后同时重置该 IP 的失败计数，避免共享出口 IP 被误伤封禁。
    if (ipKey) {
      await this.redis.del(ipKey);
    }
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
    emailCode: string | undefined,
    currentRefreshToken?: string | undefined,
    turnstileToken?: string,
  ): Promise<PublicUser> {
    if (!(await this.turnstile.verify(turnstileToken, { expectedAction: "sensitive" }))) {
      throw new BadRequestException("人机验证未通过，请重试");
    }
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
    // 敏感操作：修改密码前必须通过邮箱验证码确认（强制，见 requireEmailCodeForPassword）
    await this.requireEmailCodeForPassword(user, emailCode);
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

  async bindWallet(userId: string, wallet: string, emailCode: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("用户不存在");
    // 敏感操作：更换/绑定钱包前必须通过邮箱验证码确认
    await this.requireEmailCode(user, emailCode);
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

  /** 注销账号（软删除）：置 deletedAt，撤销全部会话；保留数据以维护审计与单据完整性 */
  async deleteAccount(userId: string, turnstileToken?: string): Promise<{ ok: boolean }> {
    if (!(await this.turnstile.verify(turnstileToken, { expectedAction: "sensitive" }))) {
      throw new BadRequestException("人机验证未通过，请重试");
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("用户不存在");
    if (user.deletedAt) throw new BadRequestException("账号已注销");
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { deletedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actorId: userId,
      action: "ACCOUNT_DELETED",
      targetType: "AUTH",
      targetId: userId,
    });
    return { ok: true };
  }

  /** 修改绑定邮箱：需先通过发送到新邮箱的验证码核验新邮箱所有权 */

  async changeName(
    userId: string,
    name: string,
    emailCode: string,
    turnstileToken?: string,
  ): Promise<PublicUser> {
    if (!(await this.turnstile.verify(turnstileToken, { expectedAction: "sensitive" }))) {
      throw new BadRequestException("人机验证未通过，请重试");
    }
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      throw new BadRequestException("姓名需为 2-100 个字符");
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("用户不存在");
    if (!user.email) {
      throw new BadRequestException("该账号未绑定邮箱，无法使用邮箱验证");
    }
    // 敏感操作：修改名称前必须通过发送到当前邮箱的验证码
    await this.emailVerification.verifyCode(user.email, emailCode);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { name: trimmed },
    });
    await this.audit.record({
      actorId: userId,
      actorEmail: user.email,
      action: "NAME_CHANGED",
      targetType: "AUTH",
      targetId: userId,
      metadata: { from: user.name, to: trimmed },
    });
    return this.publicUser(updated);
  }

  async changeEmail(
    userId: string,
    newEmail: string,
    emailCode: string,
    turnstileToken?: string,
  ): Promise<PublicUser> {
    if (!(await this.turnstile.verify(turnstileToken, { expectedAction: "sensitive" }))) {
      throw new BadRequestException("人机验证未通过，请重试");
    }
    const normalized = newEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("用户不存在");
    if (!user.email || user.email.toLowerCase() === normalized) {
      throw new BadRequestException("新邮箱不能与当前邮箱相同");
    }
    const existing = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException("该邮箱已被注册");
    }
    // 必须通过发送到新邮箱的验证码
    await this.emailVerification.verifyCode(normalized, emailCode);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: normalized,
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });
    await this.audit.record({
      actorId: userId,
      action: "EMAIL_CHANGED",
      targetType: "AUTH",
      targetId: userId,
      metadata: { from: user.email, to: normalized },
    });
    return this.publicUser(updated);
  }

  /** 发送邮箱验证码到当前登录用户（用于开启/关闭 Email OTP 及敏感操作确认）。 */
  async sendEmailOtpCode(userId: string): Promise<{
    expiresIn: number;
    cooldownSeconds: number;
    devCode?: string;
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email) throw new UnauthorizedException("用户不存在");
    const sent = await this.emailVerification.sendCode(user.email);
    return {
      expiresIn: sent.expiresIn,
      cooldownSeconds: sent.cooldownSeconds,
      ...(sent.devCode ? { devCode: sent.devCode } : {}),
    };
  }

  /**
   * 修改密码专用：一律要求邮箱验证码，必须验证通过后才能更改密码。
   * 唯一豁免：引导/运营账号「强制首登改密」且无真实邮箱（emailOtpEnabled=false + mustChangePassword=true），
   * 避免新部署引导管理员改密死锁；除此之外（含引导账号后续改密）一律强制邮箱验证码。
   */
  private async requireEmailCodeForPassword(
    user: { email: string | null; emailOtpEnabled?: boolean; mustChangePassword?: boolean },
    code: string | undefined,
  ): Promise<void> {
    if (user.emailOtpEnabled === false && user.mustChangePassword === true) return;
    if (!user.email) {
      throw new BadRequestException("该账号未绑定邮箱，无法使用邮箱验证");
    }
    if (code === undefined) {
      throw new BadRequestException("邮箱验证码为 6 位数字");
    }
    await this.emailVerification.verifyCode(user.email, code);
  }

  /** 敏感操作统一入口：校验邮箱验证码（用户必须存在邮箱）。 */
  private async requireEmailCode(
    user: { email: string | null; emailOtpEnabled?: boolean },
    code: string | undefined,
  ): Promise<void> {
    // 引导/运营账号（emailOtpEnabled=false，如种子管理员/超级管理员、超管创建的管理员）
    // 不强制邮箱验证码，避免「强制改密 + 无真实邮箱」死锁；真实用户仍强制校验。
    if (user.emailOtpEnabled === false) return;
    if (!user.email) {
      throw new BadRequestException("该账号未绑定邮箱，无法使用邮箱验证");
    }
    if (code === undefined) {
      throw new BadRequestException("邮箱验证码为 6 位数字");
    }
    await this.emailVerification.verifyCode(user.email, code);
  }

  async setupTotp(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("用户不存在");
    if (user.totpEnabled) throw new ConflictException("TOTP 已启用");
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: encryptTotpSecret(secret) },
    });
    const otpauthUrl = totpUri(secret, user.email ?? userId);
    // 生成二维码（PNG data URL），前端直接展示供用户扫码添加
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      margin: 1,
      width: 220,
      errorCorrectionLevel: "M",
    });
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  async enableTotp(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret) throw new BadRequestException("请先生成 TOTP 密钥");
    const secret = decryptTotpSecret(user.totpSecret);
    if (!isValidTotpCode(code, secret)) {
      throw new BadRequestException("TOTP 验证码错误");
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true },
    });
    await this.audit.record({
      actorId: userId,
      action: "TOTP_ENABLED",
      targetType: "AUTH",
      targetId: userId,
    });
    return { ok: true };
  }

  async disableTotp(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpEnabled) throw new BadRequestException("TOTP 未启用");
    const secret = decryptTotpSecret(user.totpSecret);
    if (!isValidTotpCode(code, secret)) {
      throw new BadRequestException("TOTP 验证码错误");
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabled: false },
    });
    await this.audit.record({
      actorId: userId,
      action: "TOTP_DISABLED",
      targetType: "AUTH",
      targetId: userId,
    });
    return { ok: true };
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
      role:
        user.role === "ADMIN" || user.role === "SUPER_ADMIN"
          ? (user.role as "ADMIN" | "SUPER_ADMIN")
          : ("USER" as const),
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
    totpEnabled?: boolean;
    emailOtpEnabled?: boolean;
    emailVerified?: boolean;
  }): PublicUser {
    return {
      id: user.id,
      email: user.email ?? "",
      name: user.name ?? "",
      role:
        user.role === "ADMIN" || user.role === "SUPER_ADMIN"
          ? (user.role as "ADMIN" | "SUPER_ADMIN")
          : ("USER" as const),
      wallet: user.wallet ?? "",
      mustChangePassword: user.mustChangePassword === true,
      totpEnabled: user.totpEnabled === true,
      emailOtpEnabled: user.emailOtpEnabled === true,
      emailVerified: user.emailVerified === true,
    };
  }
}
