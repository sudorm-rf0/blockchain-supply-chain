use anchor_lang::prelude::*;

use crate::error::TradeFinanceError;

/// 链上单据 URI 最大长度（字节）。
pub const MAX_DOCUMENT_URI_LEN: usize = 256;

/// LP Mint 精度（审计 L-05：与测试/链下约定一致，防止 NAV 语义漂移）。
pub const LP_MINT_DECIMALS: u8 = 0;

/// USDC 精度（6 位小数）。
pub const USDC_DECIMALS: u8 = 6;

/// USDC 精度换算因子：1 USDC = 1_000_000 最小单位。
pub const USDC_DECIMALS_FACTOR: u64 = 1_000_000;

/// 赎回周期窗口（秒）：一个窗口内累计赎回不得超过窗口上限（审计 M-05）。
pub const REDEEM_WINDOW_SECS: i64 = 86_400;

/// 管理员转移锁定期（秒）：上线前应调整为 >= 48h（审计 H-03）。
/// 测试环境保留 0，避免集成测试等待真实锁定期。
pub const ADMIN_TRANSFER_DELAY_SECS: i64 = 0;

/// 默认垫付额年化费率（万分位，H-04 基准档 6.70% APR）。
pub const DEFAULT_FEE_APY_BPS: u64 = 670;
/// 默认 LP 分成比例（万分位）。
pub const DEFAULT_LP_SHARE_BPS: u64 = 4000;
/// 默认平台分成比例（万分位）。
pub const DEFAULT_PLATFORM_SHARE_BPS: u64 = 5000;
/// 默认买方返利比例（万分位）。
pub const DEFAULT_REBATE_SHARE_BPS: u64 = 1000;
/// 单笔费率上限（占垫付额万分位，H-04 D7：默认 5%P）。
pub const MAX_SINGLE_FEE_BPS: u64 = 500;
/// 平台首损资金最低保留（USDC 原始单位，100 USDC）。
pub const MIN_FIRST_LOSS_ABS: u64 = 100_000_000;
/// 默认赎回后保险基金最低余额（USDC 原始单位，100 USDC，审计 L-07 可治理）。
pub const DEFAULT_MIN_INSURANCE_ABS: u64 = 100_000_000;

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
        if matches!(self.status, deal_status::SETTLED | deal_status::DEFAULTED)
            && status != self.status
        {
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
    /// 紧急暂停开关：true 时冻结全部资金移动指令
    /// （建单/存款/放款/推进/释放/还款/违约/赎回/分红）。
    pub paused: bool,
    /// 锚定的 USDC Mint（审计 S-01：链上 require_keys_eq! 校验）。
    pub usdc_mint: Pubkey,
    /// 锚定的 LP Mint（审计 S-01）。
    pub lp_mint: Pubkey,
    /// 资金池已放款、仍处于托管中的垫付总额（审计 M-01：消除 active_capital 重复计量）。
    pub escrow_funded: u64,
    /// 赎回定价（vault / lp_supply），与账面 NAV 分开披露（审计 M-04）。
    pub redemption_price: u64,
    /// 当前赎回窗口编号（now / REDEEM_WINDOW_SECS）（审计 M-05）。
    pub redeem_window_epoch: i64,
    /// 当前窗口内已累计赎回量（审计 M-05）。
    pub redeem_window_used: u64,
    /// 待接受的管理员（两步轮换，全零表示无提案）（审计 H-03）。
    pub pending_admin: Pubkey,
    /// 管理员转移提案时间（审计 H-03）。
    pub pending_admin_proposed_at: i64,
    /// 垫付额年化费率（万分位，H-04 可治理参数）。
    pub fee_apy_bps: u64,
    /// LP 分成比例（万分位，H-04 可治理参数）。
    pub lp_share_bps: u64,
    /// 平台分成比例（万分位，H-04 可治理参数）。
    pub platform_share_bps: u64,
    /// 买方返利比例（万分位，H-04 可治理参数）。
    pub rebate_share_bps: u64,
    /// 平台首损资金（真实 USDC 记账，H-04 首损层；不计入 LP 净值）。
    pub first_loss_reserve: u64,
    /// 赎回后保险基金最低余额（USDC 原始单位，审计 L-07 可治理，支持清盘路径）。
    pub min_insurance_abs: u64,
    /// 逾期罚息年化费率（万分位，审计 L-04；默认 0 表示未启用）。
    pub overdue_fee_apy_bps: u64,
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
            + 1  // paused (bool)
            + 32 // usdc_mint (Pubkey, S-01 锚定)
            + 32 // lp_mint (Pubkey, S-01 锚定)
            + 8  // escrow_funded (审计 M-01)
            + 8  // redemption_price (审计 M-04)
            + 8  // redeem_window_epoch (审计 M-05)
            + 8  // redeem_window_used (审计 M-05)
            + 32 // pending_admin (审计 H-03)
            + 8  // pending_admin_proposed_at (审计 H-03)
            + 8  // fee_apy_bps (H-04)
            + 8  // lp_share_bps (H-04)
            + 8  // platform_share_bps (H-04)
            + 8  // rebate_share_bps (H-04)
            + 8  // first_loss_reserve (H-04)
            + 8  // min_insurance_abs (L-07)
            + 8  // overdue_fee_apy_bps (L-04)
    }

    /// 累加待分配 LP 分红，溢出时返回 MathOverflow。
    pub fn add_pending_dividends(&mut self, amount: u64) -> Result<()> {
        self.pending_dividends = self
            .pending_dividends
            .checked_add(amount)
            .ok_or(TradeFinanceError::MathOverflow)?;
        Ok(())
    }

    /// 紧急暂停守卫：暂停期间拒绝资金移动类指令。
    /// 读取/查询与管理员配置（set_paused/transfer_admin/set_platform_wallet）不受限。
    pub fn ensure_not_paused(&self) -> Result<()> {
        require!(!self.paused, TradeFinanceError::PoolPaused);
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

    /// 赎回定价 = 金库现金 / LP 供应量（审计 M-04：与账面 NAV 分离）。
    pub fn calculate_redemption_price(&self, vault_balance: u64, lp_token_supply: u64) -> Result<u64> {
        require!(lp_token_supply > 0, TradeFinanceError::ZeroLpSupply);
        Ok(vault_balance / lp_token_supply)
    }

    /// 当前赎回窗口编号（审计 M-05）。
    pub fn current_redeem_window(&self, now: i64) -> i64 {
        now / REDEEM_WINDOW_SECS
    }

    /// LP 净值基准 = 金库现金 - 平台首损资金（H-04：首损不计入 LP 权益）。
    pub fn equity_base(&self, vault_balance: u64) -> Result<u64> {
        vault_balance
            .checked_sub(self.first_loss_reserve)
            .ok_or(TradeFinanceError::MathOverflow)
            .map_err(Into::into)
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
            paused: false,
            usdc_mint: Pubkey::default(),
            lp_mint: Pubkey::default(),
            escrow_funded: 0,
            redemption_price: 0,
            redeem_window_epoch: 0,
            redeem_window_used: 0,
            pending_admin: Pubkey::default(),
            pending_admin_proposed_at: 0,
            fee_apy_bps: DEFAULT_FEE_APY_BPS,
            lp_share_bps: DEFAULT_LP_SHARE_BPS,
            platform_share_bps: DEFAULT_PLATFORM_SHARE_BPS,
            rebate_share_bps: DEFAULT_REBATE_SHARE_BPS,
            first_loss_reserve: 0,
            min_insurance_abs: DEFAULT_MIN_INSURANCE_ABS,
            overdue_fee_apy_bps: 0,
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
            paused: false,
            usdc_mint: Pubkey::default(),
            lp_mint: Pubkey::default(),
            escrow_funded: 0,
            redemption_price: 0,
            redeem_window_epoch: 0,
            redeem_window_used: 0,
            pending_admin: Pubkey::default(),
            pending_admin_proposed_at: 0,
            fee_apy_bps: DEFAULT_FEE_APY_BPS,
            lp_share_bps: DEFAULT_LP_SHARE_BPS,
            platform_share_bps: DEFAULT_PLATFORM_SHARE_BPS,
            rebate_share_bps: DEFAULT_REBATE_SHARE_BPS,
            first_loss_reserve: 0,
            min_insurance_abs: DEFAULT_MIN_INSURANCE_ABS,
            overdue_fee_apy_bps: 0,
        };
        assert!(pool.add_pending_dividends(1).is_err());
        pool.pending_dividends = 100;
        pool.add_pending_dividends(50).unwrap();
        assert_eq!(pool.pending_dividends, 150);
    }

    #[test]
    fn pool_ensure_not_paused_guards_money_ops() {
        let mut pool = PoolState {
            admin: Pubkey::default(),
            total_assets: 0,
            active_capital: 0,
            reserve_fund: 0,
            insurance_fund: 0,
            pending_dividends: 0,
            platform_wallet: Pubkey::default(),
            nav: 0,
            paused: true,
            usdc_mint: Pubkey::default(),
            lp_mint: Pubkey::default(),
            escrow_funded: 0,
            redemption_price: 0,
            redeem_window_epoch: 0,
            redeem_window_used: 0,
            pending_admin: Pubkey::default(),
            pending_admin_proposed_at: 0,
            fee_apy_bps: DEFAULT_FEE_APY_BPS,
            lp_share_bps: DEFAULT_LP_SHARE_BPS,
            platform_share_bps: DEFAULT_PLATFORM_SHARE_BPS,
            rebate_share_bps: DEFAULT_REBATE_SHARE_BPS,
            first_loss_reserve: 0,
            min_insurance_abs: DEFAULT_MIN_INSURANCE_ABS,
            overdue_fee_apy_bps: 0,
        };
        assert!(pool.ensure_not_paused().is_err());
        pool.paused = false;
        assert!(pool.ensure_not_paused().is_ok());
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

    // ---- 属性测试（审计 I-03）：proptest 覆盖状态空间组合 ----
    use proptest::prelude::*;

    fn test_pool() -> PoolState {
        PoolState {
            admin: Pubkey::default(),
            total_assets: 0,
            active_capital: 0,
            reserve_fund: 0,
            insurance_fund: 0,
            pending_dividends: 0,
            platform_wallet: Pubkey::default(),
            nav: 0,
            paused: false,
            usdc_mint: Pubkey::default(),
            lp_mint: Pubkey::default(),
            escrow_funded: 0,
            redemption_price: 0,
            redeem_window_epoch: 0,
            redeem_window_used: 0,
            pending_admin: Pubkey::default(),
            pending_admin_proposed_at: 0,
            fee_apy_bps: DEFAULT_FEE_APY_BPS,
            lp_share_bps: DEFAULT_LP_SHARE_BPS,
            platform_share_bps: DEFAULT_PLATFORM_SHARE_BPS,
            rebate_share_bps: DEFAULT_REBATE_SHARE_BPS,
            first_loss_reserve: 0,
            min_insurance_abs: DEFAULT_MIN_INSURANCE_ABS,
            overdue_fee_apy_bps: 0,
        }
    }

    proptest! {
        /// NAV 单调性：金库现金不减少时 NAV 不减少。
        #[test]
        fn nav_is_monotonic_in_vault(
            active in 0u64..1_000_000_000,
            supply in 1u64..1_000_000,
            v1 in 0u64..1_000_000_000,
            delta in 0u64..1_000_000,
        ) {
            let pool = test_pool();
            let nav1 = pool.calculate_nav(v1, active, supply).unwrap();
            let nav2 = pool.calculate_nav(v1 + delta, active, supply).unwrap();
            prop_assert!(nav2 >= nav1);
        }

        /// equity_base：首损超过金库现金时返回 Err，否则为 vault - first_loss。
        #[test]
        fn equity_base_consistent(
            vault in 0u64..1_000_000_000,
            first_loss in 0u64..1_000_000_000,
        ) {
            let mut pool = test_pool();
            pool.first_loss_reserve = first_loss;
            if vault >= first_loss {
                prop_assert_eq!(pool.equity_base(vault).unwrap(), vault - first_loss);
            } else {
                prop_assert!(pool.equity_base(vault).is_err());
            }
        }

        /// 赎回窗口随时间单调不减。
        #[test]
        fn redeem_window_monotonic(
            t in 0i64..1_000_000_000i64,
            delta in 0i64..1_000_000i64,
        ) {
            let pool = test_pool();
            let w1 = pool.current_redeem_window(t);
            let w2 = pool.current_redeem_window(t + delta);
            prop_assert!(w2 >= w1);
        }

        /// set_status 任意输入不 panic（返回 Ok 或 Err）。
        #[test]
        fn set_status_never_panics(
            status in 0u8..=255u8,
            target in 0u8..=255u8,
        ) {
            let mut deal = TradeDeal {
                id: 1,
                buyer: Pubkey::default(),
                seller: Pubkey::default(),
                amount: 1_000_000,
                down_payment: 300_000,
                pool_portion: 700_000,
                tenor: 86_400,
                status,
                created_at: 0,
                repaid_at: 0,
            };
            let _ = deal.set_status(target);
        }

        /// is_expired 单调：时间推进后过期判断不会从 true 变 false。
        #[test]
        fn is_expired_monotonic(
            created in 0i64..1_000_000,
            tenor in 0i64..1_000_000,
            t1 in 0i64..3_000_000,
            delta in 0i64..1_000_000,
        ) {
            let deal = TradeDeal {
                id: 1,
                buyer: Pubkey::default(),
                seller: Pubkey::default(),
                amount: 1_000_000,
                down_payment: 300_000,
                pool_portion: 700_000,
                tenor,
                status: deal_status::REPAYING,
                created_at: created,
                repaid_at: 0,
            };
            let e1 = deal.is_expired(t1).unwrap();
            let e2 = deal.is_expired(t1 + delta).unwrap();
            prop_assert!(e2 || !e1);
        }
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

/// 分红领取台账（审计 H-02 方案 A）：记录每个接收方累计领取的分红，
/// 使 distribute_dividends 的分配行为可被链上审计。
#[account]
#[derive(InitSpace)]
pub struct DividendClaim {
    /// 接收方钱包。
    pub recipient: Pubkey,
    /// 累计已领取分红（USDC 原始单位）。
    pub total_claimed: u64,
    /// 最近一次领取时间。
    pub last_claim_at: i64,
}

impl DividendClaim {
    pub const DISCRIMINATOR_SIZE: usize = 8;

    /// 账户空间 = 8 字节 Anchor 前缀 + recipient + total_claimed + last_claim_at。
    pub fn space() -> usize {
        Self::DISCRIMINATOR_SIZE + 32 + 8 + 8
    }
}
