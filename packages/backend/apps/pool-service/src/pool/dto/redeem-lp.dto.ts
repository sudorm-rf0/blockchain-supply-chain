import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class RedeemLpDto {
  @ApiProperty({ description: "LP 钱包地址" })
  @IsString()
  lpWallet!: string;

  @ApiProperty({ description: "LP 代币数量（原始单位）" })
  @IsString()
  lpAmount!: string;
}
