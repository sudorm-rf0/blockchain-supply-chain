import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class WithdrawRequestDto {
  @ApiProperty({ description: "LP 钱包地址", example: "9xQe..." })
  @IsString()
  lpWallet!: string;

  @ApiProperty({
    description: "提款金额（USDC 原始单位，6 位小数）",
    example: "500000000",
  })
  @IsString()
  amount!: string;

  @ApiPropertyOptional({ description: "资金池地址", example: "7xYJ..." })
  @IsOptional()
  @IsString()
  poolAddress?: string;
}
