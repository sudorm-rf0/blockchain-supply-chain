export const DEAL_SYNC_JOB = "deal.sync";
export const POOL_SNAPSHOT_JOB = "pool.snapshot";

export interface DealSyncPayload {
  accountKey: string;
  tradeId: string;
  buyerWallet: string;
  sellerWallet: string;
  amount: string;
  downPayment: string;
  poolPortion: string;
  tenor: string;
  status: number;
  createdAt: string;
  repaidAt: string;
  txSignature: string | null;
  logisticsHash: string | null;
}

export interface PoolSnapshotPayload {
  poolAddress: string;
  totalAssets: string;
  activeCapital: string;
  reserveFund: string;
  insuranceFund: string;
  pendingDividends: string;
  nav: string;
  utilizationBps: number;
  /// 资金池紧急暂停开关（合约 PoolState.paused）。
  paused: boolean;
  /// 在途托管垫付（审计 M-01：PoolState.escrow_funded）。
  escrowFunded: string;
  /// 赎回定价（审计 M-04：PoolState.redemption_price）。
  redemptionPrice: string;
  /// 当前赎回窗口编号（审计 M-05）。
  redeemWindowEpoch: string;
  /// 当前窗口已累计赎回（审计 M-05）。
  redeemWindowUsed: string;
  /// 待接受的管理员（审计 H-03；全零表示无提案）。
  pendingAdmin: string;
  /// 管理员转移提案时间（审计 H-03）。
  pendingAdminProposedAt: string;
  /// 垫付额年化费率（万分位，H-04）。
  feeApyBps: string;
  /// LP 分成比例（万分位，H-04）。
  lpShareBps: string;
  /// 平台分成比例（万分位，H-04）。
  platformShareBps: string;
  /// 买方返利比例（万分位，H-04）。
  rebateShareBps: string;
  /// 平台首损资金（H-04）。
  firstLossReserve: string;
  /// 赎回后保险基金最低余额（L-07 可治理）。
  minInsuranceAbs: string;
  /// 逾期罚息年化费率（万分位，L-04）。
  overdueFeeApyBps: string;
  capturedAt: string;
}
