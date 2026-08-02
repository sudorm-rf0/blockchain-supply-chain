import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class FundTradeDto {
  @ApiProperty({
    description: "管理员钱包地址（签名者）",
    example: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  })
  @IsString()
  adminWallet!: string;
}
