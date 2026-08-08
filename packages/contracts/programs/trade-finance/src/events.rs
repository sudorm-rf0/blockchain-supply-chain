//! 链上事件定义（审计 I-01：模块化拆分）。
use anchor_lang::prelude::*;

#[event]
pub struct DealCreatedEvent {
    pub trade_id: u64,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
}
#[event]
pub struct DepositEvent {
    pub depositor: Pubkey,
    pub amount: u64,
    pub lp_shares: u64,
    pub nav: u64,
    pub redemption_price: u64,
}
#[event]
pub struct DefaultEvent {
    pub trade_id: u64,
    pub status: u8,
    pub recovered: u64,
    pub insurance_payout: u64,
}
#[event]
pub struct FundedEvent {
    pub trade_id: u64,
    pub amount: u64,
}
#[event]
pub struct DealStatusChangedEvent {
    pub trade_id: u64,
    pub status: u8,
}
#[event]
pub struct ReleasedEvent {
    pub trade_id: u64,
    pub amount: u64,
}
#[event]
pub struct DocumentAttestedEvent {
    pub trade_id: u64,
    pub owner: Pubkey,
    pub file_hash: [u8; 32],
    pub uri: String,
    pub uploaded_at: i64,
}
#[event]
pub struct RedeemedEvent {
    pub lp_user: Pubkey,
    pub lp_amount: u64,
    pub usdc_out: u64,
    pub nav: u64,
    pub redemption_price: u64,
}
#[event]
pub struct DividendDistributedEvent {
    pub recipient: Pubkey,
    pub amount: u64,
    pub remaining: u64,
    /// 该接收方累计已领取（审计 H-02 方案 A 领取台账）。
    pub total_claimed: u64,
}
#[event]
pub struct BuyerRebateEvent {
    pub buyer: Pubkey,
    pub trade_id: u64,
    pub amount: u64,
    pub total: u64,
}
#[event]
pub struct PoolPausedEvent {
    pub admin: Pubkey,
    pub paused: bool,
}
#[event]
pub struct AdminTransferredEvent {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}
#[event]
pub struct PlatformWalletUpdatedEvent {
    pub admin: Pubkey,
    pub platform_wallet: Pubkey,
}
#[event]
pub struct AdminTransferProposedEvent {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
    pub proposed_at: i64,
}
#[event]
pub struct MultisigProposedEvent {
    pub new_multisig: Pubkey,
    pub proposed_at: i64,
}
#[event]
pub struct MultisigAcceptedEvent {
    pub multisig: Option<Pubkey>,
}
#[event]
pub struct LpMintUpdatedEvent {
    pub admin: Pubkey,
    pub old_lp_mint: Pubkey,
    pub new_lp_mint: Pubkey,
}
#[event]
pub struct FeeParamsUpdatedEvent {
    pub admin: Pubkey,
    pub fee_apy_bps: u64,
    pub lp_share_bps: u64,
    pub platform_share_bps: u64,
    pub rebate_share_bps: u64,
}
#[event]
pub struct FirstLossDepositedEvent {
    pub admin: Pubkey,
    pub amount: u64,
    pub first_loss_reserve: u64,
}
#[event]
pub struct FirstLossWithdrawnEvent {
    pub admin: Pubkey,
    pub amount: u64,
    pub first_loss_reserve: u64,
}
#[event]
pub struct RiskParamsUpdatedEvent {
    pub admin: Pubkey,
    pub min_insurance_abs: u64,
    pub overdue_fee_apy_bps: u64,
}

/// 治理时锁（审计 H-1）：提案已登记，等待时锁后由 execute_* 生效。
#[event]
pub struct GovernanceActionProposedEvent {
    pub admin: Pubkey,
    pub action: u8,
    pub proposed_at: i64,
    pub delay_secs: i64,
    pub param_pubkey: Pubkey,
    pub param_u64s: [u64; 4],
}

/// 治理时锁（审计 H-1）：提案已过等待期并执行生效。
#[event]
pub struct GovernanceActionExecutedEvent {
    pub admin: Pubkey,
    pub action: u8,
    pub proposed_at: i64,
    pub executed_at: i64,
}

/// 治理时锁（审计 H-1）：管理员主动取消待执行提案。
#[event]
pub struct GovernanceActionCancelledEvent {
    pub admin: Pubkey,
    pub action: u8,
    pub cancelled_at: i64,
}
