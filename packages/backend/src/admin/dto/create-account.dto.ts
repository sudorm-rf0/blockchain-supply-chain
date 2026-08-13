import {
  IsEmail,
  IsIn,
  IsString,
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
  password!: string;

  /** 账户类型：管理员或超级管理员（用户由注册产生） */
  @IsIn(["ADMIN", "SUPER_ADMIN"])
  role!: "ADMIN" | "SUPER_ADMIN";
}
