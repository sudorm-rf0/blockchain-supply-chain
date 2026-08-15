import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class DeleteAccountDto {
  /** 两步验证码或邮箱验证码（开启 TOTP 必填 TOTP，否则必填邮箱验证码） */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: "验证码为 6 位数字" })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;
}
