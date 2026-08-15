import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class ChangeNameDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /** 敏感操作邮箱验证码（6 位数字） */
  @IsString()
  @Matches(/^\d{6}$/, { message: "邮箱验证码为 6 位数字" })
  emailCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;
}
