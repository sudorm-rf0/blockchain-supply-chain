import {
  IsEmail,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateAccountDto {
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

  /** 账户类型：管理员或超级管理员（用户由注册产生） */
  @IsIn(["ADMIN", "SUPER_ADMIN"])
  role!: "ADMIN" | "SUPER_ADMIN";
}
