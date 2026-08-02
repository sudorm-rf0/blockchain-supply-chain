import { ApiProperty } from "@nestjs/swagger";

export class CreateTradeResponseDto {
  @ApiProperty({
    description: "链上订单 id（u64 十进制字符串）",
    example: "1722537600000",
  })
  tradeId!: string;

  @ApiProperty({
    description: "待前端签名的 base64 序列化交易",
    example: "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  })
  transaction!: string;

  @ApiProperty({
    description: "交易引用区块哈希",
    example: "4xYJ...",
  })
  blockhash!: string;

  @ApiProperty({
    description: "订单 PDA 地址",
    example: "5xYJ...",
  })
  dealPda!: string;

  @ApiProperty({
    description: "30% 首付金额（USDC 原始单位）",
    example: "300000000",
  })
  downPayment!: string;

  @ApiProperty({
    description: "70% 资金池垫付金额（USDC 原始单位）",
    example: "700000000",
  })
  poolPortion!: string;

  @ApiProperty({
    description: "是否为重复请求（已存在相同参数的 PENDING 交易）",
    example: false,
  })
  duplicate?: boolean;
}
