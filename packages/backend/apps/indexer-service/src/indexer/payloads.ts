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
  capturedAt: string;
}
