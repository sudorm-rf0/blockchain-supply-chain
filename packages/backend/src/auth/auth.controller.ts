import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  Get,
  Req,
  BadRequestException,
  Patch,
} from "@nestjs/common";
import type { Request } from "express";
import { PublicKey } from "@solana/web3.js";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";

@Controller("api/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  register(
    @Body()
    body: {
      name: string;
      email: string;
      password: string;
      wallet?: string;
    },
  ) {
    return this.authService.register(body);
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() req: Request) {
    return req.user;
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
