import { IsString, Matches, MaxLength } from "class-validator";

export class BindWalletDto {
  @IsString()
  @MaxLength(64)
  wallet!: string;

  /** 敏感操作邮箱验证码（6 位数字） */
  @IsString()
  @Matches(/^\d{6}$/, { message: "邮箱验证码为 6 位数字" })
  emailCode!: string;
}
