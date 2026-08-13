import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { EmailVerificationService } from "./email-verification.service";
import { SendEmailCodeDto } from "./dto/send-email-code.dto";
import { VerifyEmailCodeDto } from "./dto/verify-email-code.dto";

@Controller("api/email-verification")
export class EmailVerificationController {
  constructor(
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  /** 发送邮箱验证码（同一 IP 10 次/分钟，服务内另有单邮箱 60s 冷却与每小时上限） */
  @Post("send")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async send(@Body() body: SendEmailCodeDto) {
    const result = await this.emailVerificationService.sendCode(body.email);
    return { ok: true, ...result };
  }

  /** 校验邮箱验证码（成功即作废，单次使用） */
  @Post("verify")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verify(@Body() body: VerifyEmailCodeDto) {
    const result = await this.emailVerificationService.verifyCode(
      body.email,
      body.code,
    );
    return { ok: true, ...result };
  }
}
