import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class ChangePasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;

  /** 敏感操作邮箱验证码（6 位数字）；引导/运营账号（emailOtpEnabled=false）可省略 */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: "邮箱验证码为 6 位数字" })
  emailCode?: string;
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;
}
