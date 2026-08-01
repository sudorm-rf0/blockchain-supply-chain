import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class CreateTradeDto {
  @ApiProperty({
    description: "买方钱包地址",
    example: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  })
  @IsString()
  buyerWallet!: string;

  @ApiProperty({
    description: "卖方钱包地址",
    example: "8xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  })
  @IsString()
  sellerWallet!: string;

  @ApiProperty({
    description: "贸易金额（USDC 原始单位，6 位小数）",
    example: "1000000000",
  })
  @IsString()
  amount!: string;

  @ApiProperty({
    description: "账期（天，30/60/90/120）",
    example: "30",
  })
  @IsString()
  tenor!: string;

  @ApiPropertyOptional({
    description: "物流哈希，用于链下溯源关联",
    example: "0xabc123",
  })
  @IsOptional()
  @IsString()
  logisticsHash?: string | null;
}
