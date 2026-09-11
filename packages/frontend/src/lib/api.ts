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
  fetchSessions,
  revokeSession,
  revokeOtherSessions,
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
  aiReviewFile,
  aiExtractFile,
  aiSummarizeFile,
  aiCompareFile,
  aiChatFile,
} from "./files-api";
export type {
  FileRecord,
  FilesResponse,
  AiReviewReport,
  AiChatMessage,
  AiCompareResult,
} from "./files-api";
export { submitFeedback, fetchFeedbackList, processFeedback } from "./feedback-api";
export type { FeedbackItem } from "./feedback-api";
export { aiChat, fetchAiHistory, fetchAiSession, deleteAiHistory, fetchAiStats } from "./ai-api";
export type { AiStats } from "./ai-api";
export type {
  AiChatMessage as AiAssistantMessage,
  AiSessionMeta,
  AiSession,
} from "./ai-api";
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
export { fetchAuditLogs, exportAuditLogs } from "./admin-api";
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

export {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  createBroadcastNotification,
  fetchNotificationBanner,
} from "./notifications-api";
export type { NotificationRecord, NotificationsResponse } from "./notifications-api";
export {
  fetchOrdersReport,
  fetchFinancingReport,
  fetchAuditReport,
  ordersExportUrl,
  financingExportUrl,
  auditExportUrl,
} from "./reports-api";
export type { ReportResponse, ReportSummary, ReportItem } from "./reports-api";
export { fetchGovernanceStatus } from "./governance-api";
export type { GovernanceStatus } from "./governance-api";
export {
  fetchApiKeys,
  createApiKey,
  revokeApiKey,
  fetchWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
} from "./integrations-api";
export type { ApiKeyRecord, WebhookRecord } from "./integrations-api";

export async function forgotPassword(email: string, turnstileToken?: string): Promise<{ expiresIn: number; cooldownSeconds: number; devCode?: string }> {
  const res = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, turnstileToken }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message ?? "发送失败，请稍后重试");
  }
  return res.json();
}

export async function resetPassword(
  email: string,
  code: string,
  newPassword: string,
  turnstileToken?: string,
): Promise<{ ok: true }> {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code, newPassword, turnstileToken }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message ?? "重置失败，请稍后重试");
  }
  return res.json();
}

