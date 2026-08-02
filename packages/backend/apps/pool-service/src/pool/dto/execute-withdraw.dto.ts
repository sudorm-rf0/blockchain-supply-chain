import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class ExecuteWithdrawDto {
  @ApiPropertyOptional({
    description: "链上执行交易签名（合约 redeem 指令落地后填写）",
  })
  @IsOptional()
  @IsString()
  txSignature?: string;
}
