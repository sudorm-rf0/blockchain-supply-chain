import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";

export class SendEmailCodeDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /** 邮件语言（zh-CN / zh-TW / en），默认 zh-CN */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  lang?: string;
}
