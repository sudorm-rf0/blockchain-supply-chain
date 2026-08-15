import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { PublicKey } from "@solana/web3.js";
import { AuthService } from "./auth.service";
import { AuthGuard } from "@supply-chain/common";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { ChangeNameDto } from "./dto/change-name.dto";
import { ChangeEmailDto } from "./dto/change-email.dto";
import { DeleteAccountDto } from "./dto/delete-account.dto";
import { BindWalletDto } from "./dto/bind-wallet.dto";
import { VerifyEmailCodeDto } from "../email-verification/dto/verify-email-code.dto";
import {
  clearAuthCookies,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
} from "./session";

function getClientIp(request: Request): string {
  return request.ip ?? "unknown";
}

@Controller("api/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async register(@Body() body: RegisterDto) {
    // 防垃圾注册：注册后不直接登录，需先输入邮箱验证码激活账号
    const result = await this.authService.register(body);
    return result;
  }

  /** 注册邮箱验证：输入 6 位验证码后账号激活，方可登录 */
  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verifyEmail(@Body() body: VerifyEmailCodeDto) {
    return this.authService.verifyEmail(body.email, body.code);
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.login(body, getClientIp(req));
    if ("requiresTotp" in session) {
      return { requiresTotp: true };
    }
    if ("requiresEmailOtp" in session) {
      // 开发环境（未配置邮件服务）附带 devCode，便于本地联调与 e2e
      return {
        requiresEmailOtp: true,
        ...(session.devCode ? { devCode: session.devCode } : {}),
      };
    }
    setAuthCookies(res, session.accessToken, session.refreshToken);
    return {
      accessToken: session.accessToken,
      user: session.user,
      mustChangePassword: session.mustChangePassword,
    };
  }

  @Post("totp/setup")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async setupTotp(@Req() req: Request) {
    return this.authService.setupTotp(req.user!.sub);
  }

  @Post("totp/enable")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async enableTotp(
    @Req() req: Request,
    @Body("code") code: string,
  ) {
    if (!/^\d{6}$/.test(code ?? "")) {
      throw new BadRequestException("TOTP 验证码为 6 位数字");
    }
    return this.authService.enableTotp(req.user!.sub, code);
  }

  @Post("totp/disable")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async disableTotp(
    @Req() req: Request,
    @Body("code") code: string,
  ) {
    if (!/^\d{6}$/.test(code ?? "")) {
      throw new BadRequestException("TOTP 验证码为 6 位数字");
    }
    return this.authService.disableTotp(req.user!.sub, code);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_TOKEN_COOKIE
    ];
    const session = await this.authService.refresh(refreshToken ?? "");
    setAuthCookies(res, session.accessToken, session.refreshToken);
    return {
      accessToken: session.accessToken,
      user: session.user,
      mustChangePassword: session.mustChangePassword,
    };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_TOKEN_COOKIE
    ];
    await this.authService.logout(refreshToken ?? "");
    clearAuthCookies(res);
    return { ok: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() req: Request) {
    return this.authService.getMe(req.user!.sub);
  }

  @Post("change-name")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async changeName(@Body() body: ChangeNameDto, @Req() req: Request) {
    const user = await this.authService.changeName(
      req.user!.sub,
      body.name,
      body.emailCode,
      body.turnstileToken,
    );
    return { ok: true, user };
  }

  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async changePassword(
    @Body() body: ChangePasswordDto,
    @Req() req: Request,
  ) {
    const refreshToken = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_TOKEN_COOKIE
    ];
    const user = await this.authService.changePassword(
      req.user!.sub,
      body.currentPassword,
      body.newPassword,
      body.emailCode,
      refreshToken,
      body.turnstileToken,
    );
    return { ok: true, user, mustChangePassword: false };
  }

  /** 修改绑定邮箱（需新邮箱验证码） */
  @Post("change-email")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async changeEmail(@Body() body: ChangeEmailDto, @Req() req: Request) {
    const user = await this.authService.changeEmail(
      req.user!.sub,
      body.newEmail,
      body.emailCode,
      body.turnstileToken,
    );
    return { ok: true, user };
  }

  /** 注销账号（软删除，需二次确认由前端弹窗完成） */
  @Post("delete-account")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async deleteAccount(@Req() req: Request, @Body() body: DeleteAccountDto) {
    return this.authService.deleteAccount(req.user!.sub, body.turnstileToken);
  }

  @Patch("wallet")
  @UseGuards(AuthGuard)
  bindWallet(@Req() req: Request, @Body() body: BindWalletDto) {
    try {
      new PublicKey(body.wallet);
    } catch {
      throw new BadRequestException("invalid Solana address");
    }
    return this.authService.bindWallet(req.user!.sub, body.wallet, body.emailCode);
  }

  /** 发送邮箱验证码（用于开启/关闭 Email OTP、修改密码、绑定钱包等敏感操作） */
  @Post("email-otp/send")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async sendEmailOtpCode(@Req() req: Request) {
    return this.authService.sendEmailOtpCode(req.user!.sub);
  }

}
