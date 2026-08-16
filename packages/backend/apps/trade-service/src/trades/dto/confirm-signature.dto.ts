import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";

export class ConfirmSignatureDto {
  @ApiProperty({
    description: "链上交易签名",
    example: "4xYJ...",
  })
  @IsString()
  txSignature!: string;

  @ApiPropertyOptional({
    description: "二次确认标记（前端历史版本会附带 confirm:true，后端接受避免 400）",
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
