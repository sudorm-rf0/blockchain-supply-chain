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

  @ApiProperty({ description: "资金池紧急暂停状态（合约 PoolState.paused）", example: false })
  paused!: boolean;

  @ApiProperty({ description: "在途托管垫付（USDC 原始单位，审计 M-01）", example: "0" })
  escrowFunded!: string;

  @ApiProperty({ description: "当前赎回单价（USDC 原始单位，审计 M-04）", example: "0" })
  redemptionPrice!: string;

  @ApiProperty({ description: "H-04 年化费率（bps，垫付额）", example: 0 })
  feeApyBps!: string;

  @ApiProperty({ description: "H-04 逾期费率（bps）", example: 0 })
  overdueFeeApyBps!: string;

  @ApiProperty({ description: "首损准备金（USDC 原始单位，H-04 first-loss tranche）", example: "0" })
  firstLossReserve!: string;

  @ApiProperty({ description: "费用分成 LP（bps，H-04）", example: 0 })
  lpShareBps!: string;

  @ApiProperty({ description: "费用分成 平台（bps，H-04）", example: 0 })
  platformShareBps!: string;

  @ApiProperty({ description: "费用分成 买方返利（bps，H-04）", example: 0 })
  rebateShareBps!: string;

  @ApiProperty({ description: "待确认新管理员（两步转移 H-03，无则为 null）", example: null })
  pendingAdmin!: string | null;

  @ApiProperty({ type: [PoolTrendPointDto] })
  trend!: PoolTrendPointDto[];
}
