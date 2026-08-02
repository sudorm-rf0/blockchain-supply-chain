import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class AdvanceTradeDto {
  @ApiProperty({
    description: "目标状态码：2=InTransit,3=CustomsClear,4=Delivered,5=Repaying",
    example: "5",
  })
  @IsString()
  targetStatus!: string;

  @ApiProperty({
    description: "管理员钱包地址（签名者）",
    example: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  })
  @IsString()
  adminWallet!: string;

  @ApiPropertyOptional({ description: "确认阶段必填：链上交易签名" })
  @IsOptional()
  @IsString()
  txSignature?: string;
}
