import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/,
    { message: "密码需≥8 位且包含大写字母、小写字母、数字和特殊符号" },
  )
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  wallet?: string;

  /** 6 位数字/字母混合邀请码（必填） */
  @IsString()
  @Matches(/^[A-Za-z0-9]{6}$/, { message: "邀请码为 6 位数字或字母" })
  inviteCode!: string;

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
