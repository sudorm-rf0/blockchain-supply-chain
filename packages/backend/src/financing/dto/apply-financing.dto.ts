import { IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";

export class ApplyFinancingDto {
  @IsString()
  invoiceId!: string;

  /** 发票金额（uUSDC 字符串） */
  @IsString()
  @Matches(/^\d+$/, { message: "发票金额格式不正确" })
  invoiceAmount!: string;

  /** 融资金额（uUSDC 字符串），不超过发票金额 × (1 - 折扣率) */
  @IsString()
  @Matches(/^\d+$/, { message: "融资金额格式不正确" })
  amount!: string;

  /** 折扣率（bps，如 800 = 8%） */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  discountRate?: number;

  /** 融资期限（天） */
  @IsInt()
  @Min(1)
  @Max(3650)
  tenorDays!: number;
}
