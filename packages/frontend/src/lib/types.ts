type UserRole = "USER" | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  wallet?: string;
  mustChangePassword?: boolean;
  totpEnabled?: boolean;
}

export type FileStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface FileRecord {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  path: string;
  hash: string;
  txSignature?: string | null;
  documentPda?: string | null;
  attestedAt?: string | null;
  status: FileStatus;
  tradeId?: string | null;
  documentGroupId?: string | null;
  version?: number;
  supersededAt?: string | null;
  isLatest?: boolean;
  description?: string | null;
  remark?: string | null;
  uploaderName?: string | null;
  createdAt: string;
}

export interface FilesResponse {
  items: FileRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface BuiltTransactionResponse {
  tradeId: string;
  transaction: string;
  blockhash: string;
  message: string;
  targetStatus?: number;
}

export interface CreateTradeRequest {
  buyerWallet: string;
  sellerWallet: string;
  amount: string;
  tenor: string;
  logisticsHash?: string | null;
}

export interface CreateTradeResponse {
  tradeId: string;
  transaction: string;
  blockhash: string;
  dealPda: string;
  downPayment: string;
  poolPortion: string;
}

export interface TradeRecord {
  id: string;
  tradeId: string;
  buyerWallet: string;
  sellerWallet: string;
  amount: string;
  downPayment: string;
  poolPortion: string;
  tenor: number;
  status: string;
  txSignature?: string | null;
  logisticsHash?: string | null;
  createdAt: string;
}

export interface AttestDocumentResponse {
  transaction: string;
  blockhash: string;
  documentPda: string;
  message: string;
}

export interface AuditLogRecord {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogsResponse {
  items: AuditLogRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadFields {
  tradeId?: string;
  documentId?: string;
  description?: string;
}

export interface PoolTrendPoint {
  capturedAt: string;
  nav: string;
  totalAssets: string;
  activeCapital: string;
  idle: string;
  utilizationBps: number;
}

export interface PoolOverview {
  poolAddress: string;
  nav: string;
  totalAssets: string;
  activeCapital: string;
  reserveFund: string;
  insuranceFund: string;
  pendingDividends: string;
  utilizationBps: number;
  aprPct: number;
  downPaymentSharePct: number;
  poolPortionSharePct: number;
  totalDeals: number;
  activeDeals: number;
  settledDeals: number;
  defaultedDeals: number;
  outstandingAmount: string;
  /// 资金池紧急暂停状态（合约 PoolState.paused，由 indexer 快照回写）。
  paused: boolean;
  /// 在途托管垫付（USDC 原始单位，审计 M-01）。
  escrowFunded: string;
  /// 当前赎回单价（USDC 原始单位，审计 M-04）。
  redemptionPrice: string;
  /// H-04 年化费率（bps，垫付额）。
  feeApyBps: string;
  /// H-04 逾期费率（bps）。
  overdueFeeApyBps: string;
  /// 首损准备金（USDC 原始单位，H-04 first-loss tranche）。
  firstLossReserve: string;
  /// 费用分成 LP（bps，H-04）。
  lpShareBps: string;
  /// 费用分成 平台（bps，H-04）。
  platformShareBps: string;
  /// 费用分成 买方返利（bps，H-04）。
  rebateShareBps: string;
  /// 待确认新管理员（两步转移 H-03，无则为 null）。
  pendingAdmin: string | null;
  trend: PoolTrendPoint[];
}

export interface WithdrawRequestRecord {
  id: string;
  lpAddress: string;
  amount: string;
  requestedAt: string;
  availableAt: string;
  status: string;
}

export interface IndexerStatus {
  service: string;
  queue: {
    wait: number;
    active: number;
    delayed: number;
    failed: number;
  };
  lastPoolSnapshotAt: string | null;
  lastDealSyncedAt: string | null;
  totalDeals: number;
  now: string;
}
