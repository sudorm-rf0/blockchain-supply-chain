import { IsString, Matches } from "class-validator";

/** 审计 H-4：还款必须提供申请人→平台的链上 USDC 转账签名（杜绝零成本标记还清）。 */
export class RepayFinancingDto {
  @IsString()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{87,88}$/, { message: "交易签名格式不正确" })
  txSignature!: string;
}
