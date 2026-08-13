import { IsEmail, MaxLength } from "class-validator";

export class SendEmailCodeDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
