import { IsOptional, IsString, MaxLength } from "class-validator";

export class UploadFileDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tradeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
