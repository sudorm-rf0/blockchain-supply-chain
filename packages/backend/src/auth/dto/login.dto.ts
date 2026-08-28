import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: "TOTP 验证码为 6 位数字" })
  totpCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: "邮箱验证码为 6 位数字" })
  emailOtpCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;

  /** 界面语言（zh-CN / zh-TW / en），用于邮件与验证码本地化 */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  lang?: string;
}
