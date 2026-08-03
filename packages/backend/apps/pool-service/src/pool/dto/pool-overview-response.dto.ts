import { ApiProperty } from "@nestjs/swagger";

export class PoolTrendPointDto {
  @ApiProperty({ example: "2026-08-02T00:00:00.000Z" })
  capturedAt!: string;

  @ApiProperty({ example: "1150000000" })
  nav!: string;

  @ApiProperty({ example: "10000000000" })
  totalAssets!: string;

  @ApiProperty({ example: "7000000000" })
  activeCapital!: string;

  @ApiProperty({ example: "3000000000" })
  idle!: string;

  @ApiProperty({ example: 7000 })
  utilizationBps!: number;
}

export class PoolOverviewResponseDto {
  @ApiProperty({ example: "7xYJ..." })
  poolAddress!: string;

  @ApiProperty({ example: "1150000000" })
  nav!: string;

  @ApiProperty({ example: "10000000000" })
  totalAssets!: string;

  @ApiProperty({ example: "7000000000" })
  activeCapital!: string;

  @ApiProperty({ example: "1000000000" })
  reserveFund!: string;

  @ApiProperty({ example: "500000000" })
  insuranceFund!: string;

  @ApiProperty({ description: "待分配 LP 分红", example: "1050000000" })
  pendingDividends!: string;

  @ApiProperty({ example: 7000 })
  utilizationBps!: number;

  @ApiProperty({ description: "实时 APR（%）", example: 10.5 })
  aprPct!: number;

  @ApiProperty({ description: "买方首付仓位占比（%）", example: 30 })
  downPaymentSharePct!: number;

  @ApiProperty({ description: "资金池垫付仓位占比（%）", example: 70 })
  poolPortionSharePct!: number;

  @ApiProperty({ example: 12 })
  totalDeals!: number;

  @ApiProperty({ example: 8 })
  activeDeals!: number;

  @ApiProperty({ example: 3 })
  settledDeals!: number;

  @ApiProperty({ example: 1 })
  defaultedDeals!: number;

  @ApiProperty({ example: "12000000000" })
  outstandingAmount!: string;

  @ApiProperty({ type: [PoolTrendPointDto] })
  trend!: PoolTrendPointDto[];
}
