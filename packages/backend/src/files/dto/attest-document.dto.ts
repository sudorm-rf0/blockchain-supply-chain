import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class AttestDocumentDto {
  @ApiProperty({
    description: "上传者 Solana 钱包地址",
    example: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  })
  @IsString()
  walletAddress!: string;

  @ApiPropertyOptional({
    description: "关联贸易订单 ID（可选）",
    example: "1722537600000",
  })
  @IsOptional()
  @IsString()
  tradeId?: string;
}

export class ConfirmAttestDocumentDto {
  @ApiProperty({
    description: "存证交易签名",
    example: "5xYJ...",
  })
  @IsString()
  txSignature!: string;

  @ApiPropertyOptional({
    description: "单据 PDA 地址",
    example: "5xYJ...",
  })
  @IsOptional()
  @IsString()
  documentPda?: string;
}
