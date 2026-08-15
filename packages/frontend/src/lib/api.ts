/** Re-export barrel — prefer importing from individual modules for tree-shaking. */
export {
  login,
  register,
  verifyEmail,
  sendEmailCode,
  sendEmailOtpCode,
  bindWallet,
  getMe,
  fetchSession,
  logout,
  changePassword,
  changeName,
  changeEmail,
  deleteAccount,
  setupTotp,
  enableTotp,
  disableTotp,
} from "./auth-api";
export type { AuthUser } from "./auth-api";
export {
  uploadFile,
  analyzeFile,
  translateFile,
  verifyTranslation,
  uploadFileWithProgress,
  getFiles,
  getFile,
  fetchFileVersions,
  fetchFileBlob,
  deleteFile,
  reviewFile,
  batchReviewFiles,
  buildDocumentAttest,
  confirmDocumentAttest,
} from "./files-api";
export type { FileRecord, FilesResponse } from "./files-api";
export {
  createTrade,
  confirmTrade,
  fetchMyTrades,
  fetchTrade,
  fetchAllTrades,
  buildFundTrade,
  confirmFundTrade,
  buildAdvanceTrade,
  confirmAdvanceTrade,
  buildRepayTrade,
  confirmRepayTrade,
  buildDefaultTrade,
  confirmDefaultTrade,
  buildReleaseTrade,
  confirmReleaseTrade,
} from "./trades-api";
export type {
  CreateTradeRequest,
  CreateTradeResponse,
  TradeRecord,
  BuiltTransactionResponse,
} from "./trades-api";
export {
  fetchPoolOverview,
  buildRedeemLp,
  confirmRedeemLp,
  fetchWithdrawRequests,
  executeWithdrawal,
} from "./pool-api";
export {
  listAccounts,
  getAccount,
  createAccount,
  changeAccountRole,
  generateInviteCodes,
  fetchInviteCodes,
  fetchInviteCodesExport,
  fetchInviteStats,
} from "./accounts-api";
export type {
  AccountRecord,
  AccountsResponse,
  AccountRole,
  AccountDeal,
  AccountFile,
  AccountDetail,
  InviteCodeRecord,
  InviteStats,
} from "./accounts-api";
export type { PoolOverview, WithdrawRequestRecord } from "./pool-api";
export { fetchIndexerStatus } from "./indexer-api";
export type { IndexerStatus } from "./indexer-api";
export { fetchAuditLogs } from "./admin-api";
export type { AuditLogRecord, AuditLogsResponse } from "./admin-api";
export type {
  FileStatus,
  AttestDocumentResponse,
  AuditLogRecord as AuditLogRecordType,
  UploadProgress,
  UploadFields,
  PoolTrendPoint,
} from "./types";
export {
  applyFinancing,
  fetchMyFinancing,
  fetchAdminFinancing,
  reviewFinancing,
  repayFinancing,
} from "./financing-api";
export type { FinancingRecord } from "./financing-api";
export { formatUsdc } from "./http";
export type { AttestDocumentResponse as AttestDocumentResponseType } from "./types";
