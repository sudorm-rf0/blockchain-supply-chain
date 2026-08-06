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
    /// 注意：此布局与 indexer 的
    /// packages/backend/apps/indexer-service/src/indexer/trade-deal.parser.ts
    /// （TRADE_DEAL_ACCOUNT_SIZE 与偏移）锚定，改动字段必须同步，
    /// 并同步 layout-anchor.spec.ts 中的布局表。
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

    /// 账期是否已到期：当前时间大于等于 created_at + tenor。
    pub fn is_expired(&self, now: i64) -> Result<bool> {
        let deadline = self
            .created_at
            .checked_add(self.tenor)
            .ok_or(TradeFinanceError::MathOverflow)?;
        Ok(now >= deadline)
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
    /// 注意：此布局与 indexer 的
    /// packages/backend/apps/indexer-service/src/indexer/pool-state.parser.ts
    /// （POOL_STATE_ACCOUNT_SIZE 与偏移）锚定，改动字段必须同步，
    /// 并同步 layout-anchor.spec.ts 中的布局表。
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deal_is_expired_at_deadline() {
        let deal = TradeDeal {
            id: 1,
            buyer: Pubkey::default(),
            seller: Pubkey::default(),
            amount: 1_000_000,
            down_payment: 300_000,
            pool_portion: 700_000,
            tenor: 86_400,
            status: deal_status::REPAYING,
            created_at: 1_000,
            repaid_at: 0,
        };
        // deadline = created_at + tenor = 1_000 + 86_400 = 87_400
        assert_eq!(deal.is_expired(87_399).unwrap(), false);
        assert_eq!(deal.is_expired(87_400).unwrap(), true);
        assert_eq!(deal.is_expired(1_086_400).unwrap(), true);
    }

    #[test]
    fn deal_set_status_accepts_legal_transitions() {
        let mut deal = TradeDeal {
            id: 1,
            buyer: Pubkey::default(),
            seller: Pubkey::default(),
            amount: 1_000_000,
            down_payment: 300_000,
            pool_portion: 700_000,
            tenor: 86_400,
            status: deal_status::FUNDED,
            created_at: 1_000,
            repaid_at: 0,
        };
        deal.set_status(deal_status::IN_TRANSIT).unwrap();
        assert_eq!(deal.status, deal_status::IN_TRANSIT);
        deal.set_status(deal_status::CUSTOMS_CLEAR).unwrap();
        deal.set_status(deal_status::DELIVERED).unwrap();
        deal.set_status(deal_status::REPAYING).unwrap();
        deal.set_status(deal_status::SETTLED).unwrap();
        assert_eq!(deal.status, deal_status::SETTLED);
    }

    #[test]
    fn deal_set_status_rejects_unknown_codes() {
        let mut deal = TradeDeal {
            id: 1,
            buyer: Pubkey::default(),
            seller: Pubkey::default(),
            amount: 1_000_000,
            down_payment: 300_000,
            pool_portion: 700_000,
            tenor: 86_400,
            status: deal_status::PENDING,
            created_at: 1_000,
            repaid_at: 0,
        };
        assert!(deal.set_status(99).is_err());
        assert!(deal.set_status(255).is_err());
    }

    #[test]
    fn deal_set_status_locks_settled() {
        let mut deal = TradeDeal {
            id: 1,
            buyer: Pubkey::default(),
            seller: Pubkey::default(),
            amount: 1_000_000,
            down_payment: 300_000,
            pool_portion: 700_000,
            tenor: 86_400,
            status: deal_status::SETTLED,
            created_at: 1_000,
            repaid_at: 0,
        };
        assert!(deal.set_status(deal_status::FUNDED).is_err());
        assert!(deal.set_status(deal_status::DEFAULTED).is_err());
    }

    #[test]
    fn pool_nav_requires_supply_and_handles_overflow() {
        let pool = PoolState {
            admin: Pubkey::default(),
            total_assets: 1_000,
            active_capital: 0,
            reserve_fund: 0,
            insurance_fund: 0,
            pending_dividends: 0,
            platform_wallet: Pubkey::default(),
            nav: 0,
        };
        assert!(pool.calculate_nav(1_000, 0, 0).is_err());
        let nav = pool.calculate_nav(1_000_000, 0, 1_000).unwrap();
        assert_eq!(nav, 1_000);
        // 溢出：idle + outstanding 超过 u64
        assert!(pool
            .calculate_nav(u64::MAX, u64::MAX, 1)
            .is_err());
    }

    #[test]
    fn pool_add_pending_dividends_rejects_overflow() {
        let mut pool = PoolState {
            admin: Pubkey::default(),
            total_assets: 0,
            active_capital: 0,
            reserve_fund: 0,
            insurance_fund: 0,
            pending_dividends: u64::MAX,
            platform_wallet: Pubkey::default(),
            nav: 0,
        };
        assert!(pool.add_pending_dividends(1).is_err());
        pool.pending_dividends = 100;
        pool.add_pending_dividends(50).unwrap();
        assert_eq!(pool.pending_dividends, 150);
    }

    #[test]
    fn deal_is_expired_handles_overflow() {
        let deal = TradeDeal {
            id: 1,
            buyer: Pubkey::default(),
            seller: Pubkey::default(),
            amount: 1_000_000,
            down_payment: 300_000,
            pool_portion: 700_000,
            tenor: i64::MAX,
            status: deal_status::REPAYING,
            created_at: 1,
            repaid_at: 0,
        };
        let error = deal.is_expired(0).unwrap_err();
        assert!(error.to_string().contains("MathOverflow"));
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

/// 买方返利累计账户：记录每个买方累计获得的返利，形成链上“买家子账户”。
#[account]
#[derive(InitSpace)]
pub struct RebateRecord {
    /// 买方钱包。
    pub buyer: Pubkey,
    /// 累计返利金额（USDC 原始单位）。
    pub total_rebate: u64,
}

impl RebateRecord {
    pub const DISCRIMINATOR_SIZE: usize = 8;

    /// 账户空间 = 8 字节 Anchor 前缀 + buyer + total_rebate。
    pub fn space() -> usize {
        Self::DISCRIMINATOR_SIZE + 32 + 8
    }
}
