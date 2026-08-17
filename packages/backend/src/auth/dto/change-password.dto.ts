import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class ChangePasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/,
    { message: "密码需≥8 位且包含大写字母、小写字母、数字和特殊符号" },
  )
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
