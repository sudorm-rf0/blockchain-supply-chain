import { IsOptional, IsString, MaxLength } from "class-validator";

export class DeleteAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;
}
