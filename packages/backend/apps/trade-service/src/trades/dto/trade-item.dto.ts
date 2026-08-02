import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class TradeItemDto {
  @ApiProperty({ description: "数据库记录 id（订单 PDA）" })
  id!: string;

  @ApiProperty({ description: "链上订单 id" })
  tradeId!: string;

  @ApiProperty({ description: "买方钱包" })
  buyerWallet!: string;

  @ApiProperty({ description: "卖方钱包" })
  sellerWallet!: string;

  @ApiProperty({ description: "金额（USDC 原始单位）" })
  amount!: string;

  @ApiProperty({ description: "30% 首付" })
  downPayment!: string;

  @ApiProperty({ description: "70% 垫付" })
  poolPortion!: string;

  @ApiProperty({ description: "账期（天）" })
  tenor!: number;

  @ApiProperty({ description: "状态" })
  status!: string;

  @ApiPropertyOptional({ description: "上链交易签名" })
  txSignature?: string | null;

  @ApiPropertyOptional({ description: "物流哈希" })
  logisticsHash?: string | null;

  @ApiProperty({ description: "创建时间" })
  createdAt!: string;
}
