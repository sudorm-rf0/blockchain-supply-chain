import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";

export class ExecuteWithdrawDto {
  @ApiProperty({
    description: "管理员二次确认标记，必须为 true",
  })
  @IsBoolean()
  confirm!: boolean;

  @ApiPropertyOptional({
    description: "链上执行交易签名（合约 redeem 指令落地后填写）",
  })
  @IsOptional()
  @IsString()
  txSignature?: string;
}
