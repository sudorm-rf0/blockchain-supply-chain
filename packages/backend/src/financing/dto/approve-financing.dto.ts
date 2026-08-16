import { IsString, Matches } from "class-validator";

/** 审计 H-4：放款必须提供平台→申请人的链上 USDC 转账签名。 */
export class ApproveFinancingDto {
  @IsString()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{87,88}$/, { message: "交易签名格式不正确" })
  txSignature!: string;
}
