import { IsEmail, IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class ChangeEmailDto {
  @IsEmail()
  @MaxLength(254)
  newEmail!: string;

  /** 发送到新邮箱的验证码（6 位数字） */
  @IsString()
  @Matches(/^\d{6}$/, { message: "邮箱验证码为 6 位数字" })
  emailCode!: string;

  /** 两步验证码（开启 TOTP 后必填，6 位数字） */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: "两步验证码为 6 位数字" })
  totpCode?: string;
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;
}
