import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class ConfirmRedeemDto {
  @ApiProperty({ description: "LP 代币数量（原始单位）" })
  @IsString()
  lpAmount!: string;

  @ApiProperty({ description: "链上交易签名" })
  @IsString()
  txSignature!: string;
}
