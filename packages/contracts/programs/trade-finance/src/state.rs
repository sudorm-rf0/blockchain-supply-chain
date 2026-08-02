use anchor_lang::prelude::*;

use crate::error::TradeFinanceError;

/// 链上单据 URI 最大长度（字节）。
pub const MAX_DOCUMENT_URI_LEN: usize = 256;

/// TradeDeal.status 常量映射。
pub mod deal_status {
    pub const PENDING: u8 = 0;
    pub const FUNDED: u8 = 1;
    pub const IN_TRANSIT: u8 = 2;
    pub const CUSTOMS_CLEAR: u8 = 3;
    pub const DELIVERED: u8 = 4;
    pub const REPAYING: u8 = 5;
    pub const SETTLED: u8 = 6;
    pub const DEFAULTED: u8 = 7;
}

/// 单笔贸易融资订单。
#[account]
#[derive(InitSpace)]
pub struct TradeDeal {
    pub id: u64,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    /// 订单金额，USDC 6 位小数。
    pub amount: u64,
    /// 买方首付，为 amount 的 30%。
    pub down_payment: u64,
    /// 资金池承担的比例金额。
    pub pool_portion: u64,
    /// 账期，单位秒。
    pub tenor: i64,
    /// 状态，见 deal_status 常量映射。
    pub status: u8,
    pub created_at: i64,
    /// 结清时间；未结清为 0。
    pub repaid_at: i64,
}

impl TradeDeal {
    pub const DISCRIMINATOR_SIZE: usize = 8;

    /// 账户空间 = 8 字节 Anchor 前缀 + 各字段长度。
    pub fn space() -> usize {
        Self::DISCRIMINATOR_SIZE
            + 8  // id
            + 32 // buyer
            + 32 // seller
            + 8  // amount
            + 8  // down_payment
            + 8  // pool_portion
            + 8  // tenor
            + 1  // status
            + 8  // created_at
            + 8  // repaid_at
    }

    /// 状态机校验：非法状态码返回 InvalidStatus，Settled 后不可再变更。
    pub fn set_status(&mut self, status: u8) -> Result<()> {
        if !matches!(status, deal_status::PENDING..=deal_status::DEFAULTED) {
            return Err(TradeFinanceError::InvalidStatus.into());
        }
        if self.status == deal_status::SETTLED && status != deal_status::SETTLED {
            return Err(TradeFinanceError::InvalidStateTransition.into());
        }
        self.status = status;
        Ok(())
    }
}

/// 全局资金池账户。
#[account]
#[derive(InitSpace)]
pub struct PoolState {
    /// 资金池管理员。
    pub admin: Pubkey,
    /// 全部在管资产。
    pub total_assets: u64,
    /// 处于融资占用中的资金。
    pub active_capital: u64,
    /// 风险准备金。
    pub reserve_fund: u64,
    /// 保险基金。
    pub insurance_fund: u64,
    /// 待分配 LP 分红。
    pub pending_dividends: u64,
    /// 平台运营钱包。
    pub platform_wallet: Pubkey,
    /// 资金池净值。
    pub nav: u64,
}

impl PoolState {
    pub const DISCRIMINATOR_SIZE: usize = 8;

    /// 账户空间 = 8 字节 Anchor 前缀 + 各字段长度。
    pub fn space() -> usize {
        Self::DISCRIMINATOR_SIZE
            + 32 // admin
            + 8  // total_assets
            + 8  // active_capital
            + 8  // reserve_fund
            + 8  // insurance_fund
            + 8  // pending_dividends
            + 32 // platform_wallet
            + 8  // nav
    }

    /// 累加待分配 LP 分红，溢出时返回 MathOverflow。
    pub fn add_pending_dividends(&mut self, amount: u64) -> Result<()> {
        self.pending_dividends = self
            .pending_dividends
            .checked_add(amount)
            .ok_or(TradeFinanceError::MathOverflow)?;
        Ok(())
    }

    /// NAV = (闲置稳定币余额 + 未偿还贸易净值) / LP 代币总供应量。
    pub fn calculate_nav(
        &self,
        idle_stablecoin_balance: u64,
        outstanding_trade_nav: u64,
        lp_token_supply: u64,
    ) -> Result<u64> {
        require!(lp_token_supply > 0, TradeFinanceError::ZeroLpSupply);
        let total_value = idle_stablecoin_balance
            .checked_add(outstanding_trade_nav)
            .ok_or(TradeFinanceError::MathOverflow)?;
        Ok(total_value / lp_token_supply)
    }
}

/// 链上单据存证记录：SHA-256 哈希写入 PDA，URI 指向链下文件。
#[account]
pub struct DocumentRecord {
    /// 关联贸易订单 ID；0 表示未关联订单。
    pub trade_id: u64,
    /// 上传者钱包。
    pub owner: Pubkey,
    /// 文件 SHA-256 哈希（32 字节）。
    pub file_hash: [u8; 32],
    /// 链下文件 URI（如 /uploads/xxx.pdf）。
    pub uri: String,
    /// 存证时间戳。
    pub uploaded_at: i64,
}

impl DocumentRecord {
    pub const DISCRIMINATOR_SIZE: usize = 8;

    /// 账户空间 = 8 字节 Anchor 前缀 + 固定字段 + String 长度前缀 + 最大 URI 长度。
    pub fn space() -> usize {
        Self::DISCRIMINATOR_SIZE
            + 8  // trade_id
            + 32 // owner
            + 32 // file_hash
            + 4  // String 长度前缀
            + MAX_DOCUMENT_URI_LEN
            + 8  // uploaded_at
    }
}
