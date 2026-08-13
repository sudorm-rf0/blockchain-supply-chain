import { IsEmail, IsString, Matches, MaxLength } from "class-validator";

export class VerifyEmailCodeDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: "验证码为 6 位数字" })
  code!: string;
}
