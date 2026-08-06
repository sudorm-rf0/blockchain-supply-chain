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
  async register(
    @Body() body: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.register(body);
    setAuthCookies(res, session.accessToken, session.refreshToken);
    return {
      accessToken: session.accessToken,
      user: session.user,
      mustChangePassword: session.mustChangePassword,
    };
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
      refreshToken,
    );
    return { ok: true, user, mustChangePassword: false };
  }

  @Patch("wallet")
  @UseGuards(AuthGuard)
  bindWallet(
    @Req() req: Request,
    @Body("wallet") wallet: string,
  ) {
    if (!wallet) {
      throw new BadRequestException("wallet is required");
    }
    try {
      new PublicKey(wallet);
    } catch {
      throw new BadRequestException("invalid Solana address");
    }
    return this.authService.bindWallet(req.user!.sub, wallet);
  }
}
