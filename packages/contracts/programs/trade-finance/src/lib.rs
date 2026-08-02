use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::error::TradeFinanceError;
use crate::state::{deal_status, DocumentRecord, MAX_DOCUMENT_URI_LEN, PoolState, TradeDeal};

declare_id!("9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3");

pub mod error;
pub mod state;

// ==== 分段标识: 业务常量 ====
/// 首付比例，3000 bps = 30.00%。
pub const DOWN_PAYMENT_BPS: u64 = 3000;
/// 万分位基数，用于 bps 换算。
pub const BPS_BASE: u64 = 10_000;
/// 允许账期：30 天。
pub const TENOR_30_DAYS: i64 = 30 * 86_400;
/// 允许账期：60 天。
pub const TENOR_60_DAYS: i64 = 60 * 86_400;
/// 允许账期：90 天。
pub const TENOR_90_DAYS: i64 = 90 * 86_400;
/// 允许账期：120 天。
pub const TENOR_120_DAYS: i64 = 120 * 86_400;
/// 单笔订单集中度上限：1%，以 bps 表示。
pub const MAX_CONCENTRATION_BPS: u64 = 100;
/// 资金池放款比例，7000 bps = 70.00%。
pub const FUNDING_PCT_BPS: u64 = 7000;
/// 买方还款费率，250 bps = 2.50%（按 70% 本金计算）。
pub const FEE_PCT_BPS: u64 = 250;
/// 平台运营钱包分成比例，5000 bps = 50%（占费用）。
pub const PLATFORM_FEE_PCT_BPS: u64 = 5000;
/// 买家返利比例，1000 bps = 10%（占费用）。
pub const BUYER_REBATE_PCT_BPS: u64 = 1000;
/// LP 分红比例，4000 bps = 40%（占费用）。
pub const LP_DIVIDEND_PCT_BPS: u64 = 4000;
/// 存入资金进入风险准备金的占比，8000 bps = 80%。
pub const RESERVE_FUND_PCT_BPS: u64 = 8000;
/// 存入资金进入保险基金的占比，2000 bps = 20%。
pub const INSURANCE_FUND_PCT_BPS: u64 = 2000;
/// 违约时保险基金按资金池垫付额的赔付比例，1000 bps = 10%。
pub const INSURANCE_PAYOUT_PCT_BPS: u64 = 1000;
/// LP 单次赎回占闲置资金的最高比例，5000 bps = 50%。
pub const MAX_REDEEM_BPS: u64 = 5000;
/// 赎回后保险基金最低余额（USDC 原始单位，100 USDC）。
pub const MIN_INSURANCE_ABS: u64 = 100_000_000;

// ==== 分段标识: 账户数据结构 ====
// TradeDeal 与 PoolState 定义在 state.rs，含 space() 与状态机辅助方法。

/// 只读查询返回的资金池状态快照。
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PoolStateInfo {
    pub admin: Pubkey,
    pub total_assets: u64,
    pub active_capital: u64,
    pub reserve_fund: u64,
    pub insurance_fund: u64,
    pub pending_dividends: u64,
    pub platform_wallet: Pubkey,
    pub nav: u64,
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
}

/// 校验物流状态推进是否合法：Funded -> InTransit -> CustomsClear -> Delivered。
fn validate_advance(from: u8, to: u8) -> Result<()> {
    match (from, to) {
        (deal_status::FUNDED, deal_status::IN_TRANSIT)
        | (deal_status::IN_TRANSIT, deal_status::CUSTOMS_CLEAR)
        | (deal_status::CUSTOMS_CLEAR, deal_status::DELIVERED) => Ok(()),
        _ => Err(TradeFinanceError::InvalidStateTransition.into()),
    }
}

// ==== 分段标识: 指令实现 ====
#[program]
pub mod trade_finance {
    use super::*;

    /// 初始化资金池管理员与全局资金池账户。
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        platform_wallet: Pubkey,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool_state;
        pool.admin = ctx.accounts.admin.key();
        pool.platform_wallet = platform_wallet;
        pool.total_assets = 0;
        pool.active_capital = 0;
        pool.reserve_fund = 0;
        pool.insurance_fund = 0;
        pool.pending_dividends = 0;
        pool.nav = 0;

        msg!("pool initialized by {}", pool.admin);
        Ok(())
    }

    /// 查询资金池当前状态（无状态变更）。
    pub fn get_pool_info(ctx: Context<GetPoolInfo>) -> Result<PoolStateInfo> {
        let pool = &ctx.accounts.pool_state;
        Ok(PoolStateInfo {
            admin: pool.admin,
            total_assets: pool.total_assets,
            active_capital: pool.active_capital,
            reserve_fund: pool.reserve_fund,
            insurance_fund: pool.insurance_fund,
            pending_dividends: pool.pending_dividends,
            platform_wallet: pool.platform_wallet,
            nav: pool.nav,
        })
    }

    /// 单据存证：把文件 SHA-256 哈希写入独立 PDA，供审计与溯源。
    pub fn attest_document(
        ctx: Context<AttestDocument>,
        trade_id: u64,
        file_hash: [u8; 32],
        uri: String,
    ) -> Result<()> {
        require!(
            !uri.is_empty() && uri.len() <= MAX_DOCUMENT_URI_LEN,
            TradeFinanceError::InvalidDocumentUri
        );

        if let Some(deal) = &ctx.accounts.deal {
            require!(
                deal.id == trade_id,
                TradeFinanceError::TradeNotFound
            );
            require!(
                ctx.accounts.owner.key() == deal.buyer
                    || ctx.accounts.owner.key() == deal.seller,
                TradeFinanceError::InvalidDocumentOwner
            );
        }

        let clock = Clock::get()?;
        let document = &mut ctx.accounts.document;
        document.trade_id = trade_id;
        document.owner = ctx.accounts.owner.key();
        document.file_hash = file_hash;
        document.uri = uri.clone();
        document.uploaded_at = clock.unix_timestamp;

        emit!(DocumentAttestedEvent {
            trade_id,
            owner: document.owner,
            file_hash,
            uri: document.uri.clone(),
            uploaded_at: document.uploaded_at,
        });

        msg!(
            "document attested: trade_id={}, owner={}, uri={}",
            trade_id,
            document.owner,
            document.uri
        );
        Ok(())
    }

    /// 创建贸易订单：校验账期与 1% 集中度，模拟锁定 30% 首付。
    pub fn create_deal(
        ctx: Context<CreateDeal>,
        id: u64,
        seller: Pubkey,
        amount: u64,
        tenor_days: u64,
    ) -> Result<()> {
        require!(amount > 0, TradeFinanceError::InvalidAmount);
        require!(
            matches!(tenor_days, 30 | 60 | 90 | 120),
            TradeFinanceError::InvalidTenor
        );

        let tenor = i64::try_from(
            tenor_days
                .checked_mul(86_400)
                .ok_or(TradeFinanceError::MathOverflow)?,
        )
        .map_err(|_| TradeFinanceError::MathOverflow)?;

        let down_payment = amount
            .checked_mul(DOWN_PAYMENT_BPS)
            .ok_or(TradeFinanceError::MathOverflow)?
            .checked_div(BPS_BASE)
            .ok_or(TradeFinanceError::MathOverflow)?;
        let pool_portion = amount
            .checked_sub(down_payment)
            .ok_or(TradeFinanceError::MathOverflow)?;

        // 单笔 1% 集中度上限：pool_portion <= total_assets * 1 / 100
        let concentration_limit = ctx
            .accounts
            .pool_state
            .total_assets
            .checked_mul(1)
            .ok_or(TradeFinanceError::MathOverflow)?
            .checked_div(100)
            .ok_or(TradeFinanceError::MathOverflow)?;
        require!(
            pool_portion <= concentration_limit,
            TradeFinanceError::OverConcentration
        );

        // 锁定 30% 首付：买方 USDC 实际转入订单托管账户（deal 持有）。
        require!(
            ctx.accounts.buyer_token_account.amount >= down_payment,
            TradeFinanceError::InsufficientFunds
        );
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_token_account.to_account_info(),
                    to: ctx.accounts.deal_token_account.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            down_payment,
        )?;

        let clock = Clock::get()?;
        let deal = &mut ctx.accounts.deal;
        deal.id = id;
        deal.buyer = ctx.accounts.buyer.key();
        deal.seller = seller;
        deal.amount = amount;
        deal.down_payment = down_payment;
        deal.pool_portion = pool_portion;
        deal.tenor = tenor;
        deal.status = deal_status::PENDING;
        deal.created_at = clock.unix_timestamp;
        deal.repaid_at = 0;

        let pool = &mut ctx.accounts.pool_state;
        pool.total_assets = pool
            .total_assets
            .checked_add(amount)
            .ok_or(TradeFinanceError::MathOverflow)?;

        msg!(
            "deal {} created: buyer={}, seller={}, amount={}",
            deal.id,
            deal.buyer,
            deal.seller,
            deal.amount
        );
        Ok(())
    }

    /// LP 存入稳定币：按 80%/20% 计入风险准备金与保险基金。
    pub fn deposit_pool(ctx: Context<DepositPool>, amount: u64) -> Result<()> {
        require!(amount > 0, TradeFinanceError::InvalidAmount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.depositor_token_account.to_account_info(),
                    to: ctx.accounts.pool_token_account.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amount,
        )?;
        ctx.accounts.pool_token_account.reload()?;

        let pool = &mut ctx.accounts.pool_state;
        let reserve_portion = amount
            .checked_mul(RESERVE_FUND_PCT_BPS)
            .ok_or(TradeFinanceError::MathOverflow)?
            / BPS_BASE;
        let insurance_portion = amount
            .checked_sub(reserve_portion)
            .ok_or(TradeFinanceError::MathOverflow)?;

        pool.reserve_fund = pool
            .reserve_fund
            .checked_add(reserve_portion)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.insurance_fund = pool
            .insurance_fund
            .checked_add(insurance_portion)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.total_assets = pool
            .total_assets
            .checked_add(amount)
            .ok_or(TradeFinanceError::MathOverflow)?;

        let vault_amount = ctx.accounts.pool_token_account.amount;
        let lp_supply = ctx.accounts.lp_mint.supply;
        pool.nav = pool.calculate_nav(vault_amount, pool.active_capital, lp_supply)?;

        msg!("pool deposit: {} USDC, nav: {}", amount, pool.nav);
        Ok(())
    }

    /// LP 赎回：按 NAV 换算并销毁 LP 代币，同时受单次上限与保险池保护。
    pub fn redeem_lp(ctx: Context<RedeemLp>, lp_amount: u64) -> Result<()> {
        require!(
            lp_amount > 0,
            TradeFinanceError::ZeroRedeemAmount
        );
        require!(
            ctx.accounts.lp_user_token_account.amount >= lp_amount,
            TradeFinanceError::InsufficientLpTokens
        );

        let lp_supply = ctx.accounts.lp_mint.supply;
        require!(lp_supply > 0, TradeFinanceError::ZeroLpSupply);
        let vault_before = ctx.accounts.pool_token_account.amount;
        require!(vault_before > 0, TradeFinanceError::InsufficientFunds);

        let usdc_out = ((lp_amount as u128)
            .checked_mul(vault_before as u128)
            .ok_or(TradeFinanceError::MathOverflow)?
            / lp_supply as u128) as u64;
        require!(
            usdc_out > 0,
            TradeFinanceError::ZeroRedeemAmount
        );

        let max_redeem = ((vault_before as u128)
            .checked_mul(MAX_REDEEM_BPS as u128)
            .ok_or(TradeFinanceError::MathOverflow)?
            / BPS_BASE as u128) as u64;
        require!(
            usdc_out <= max_redeem,
            TradeFinanceError::MaxRedeemExceeded
        );

        let pool = &mut ctx.accounts.pool_state;
        let total_before = pool.total_assets;
        let reserve_before = pool.reserve_fund;
        let insurance_before = pool.insurance_fund;
        let total_after = total_before
            .checked_sub(usdc_out)
            .ok_or(TradeFinanceError::MathOverflow)?;
        require!(
            pool.active_capital <= total_after,
            TradeFinanceError::InsufficientFunds
        );

        let reserve_out = ((reserve_before as u128)
            .checked_mul(usdc_out as u128)
            .ok_or(TradeFinanceError::MathOverflow)?
            / total_before as u128) as u64;
        let insurance_out = ((insurance_before as u128)
            .checked_mul(usdc_out as u128)
            .ok_or(TradeFinanceError::MathOverflow)?
            / total_before as u128) as u64;
        let insurance_after = insurance_before
            .checked_sub(insurance_out)
            .ok_or(TradeFinanceError::MathOverflow)?;
        require!(
            insurance_after >= MIN_INSURANCE_ABS,
            TradeFinanceError::InsuranceRatioTooLow
        );

        let pool_bump = [ctx.bumps.pool_authority];
        let pool_signer: &[&[u8]] = &[b"trade_finance", b"pool_usdc", &pool_bump];

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    from: ctx.accounts.lp_user_token_account.to_account_info(),
                    authority: ctx.accounts.lp_user.to_account_info(),
                    mint: ctx.accounts.lp_mint.to_account_info(),
                },
            ),
            lp_amount,
        )?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_token_account.to_account_info(),
                    to: ctx.accounts.lp_user_usdc_token_account.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
            )
            .with_signer(&[pool_signer]),
            usdc_out,
        )?;

        ctx.accounts.pool_token_account.reload()?;
        pool.total_assets = total_after;
        pool.reserve_fund = reserve_before
            .checked_sub(reserve_out)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.insurance_fund = insurance_after;
        let vault_after = ctx.accounts.pool_token_account.amount;
        let lp_supply_after = ctx.accounts.lp_mint.supply;
        pool.nav = pool.calculate_nav(vault_after, pool.active_capital, lp_supply_after)?;

        emit!(RedeemedEvent {
            lp_user: ctx.accounts.lp_user.key(),
            lp_amount,
            usdc_out,
        });

        msg!(
            "redeemed {} LP for {} USDC by {}",
            lp_amount,
            usdc_out,
            ctx.accounts.lp_user.key()
        );
        Ok(())
    }

    /// 管理员放款：记录已投放资金并推进订单状态（暂不实际转账）。
    pub fn fund_deal(ctx: Context<FundDeal>, trade_id: u64) -> Result<()> {
        require!(
            ctx.accounts.pool_state.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        require!(
            ctx.accounts.deal.id == trade_id,
            TradeFinanceError::TradeNotFound
        );
        require!(
            ctx.accounts.deal.status == deal_status::PENDING,
            TradeFinanceError::DealNotPending
        );

        let funding_amount = ctx.accounts.deal.pool_portion;

        // 放款：资金池 vault 实际转入订单托管账户；到货后再由托管释放给卖方。
        let pool_bump = [ctx.bumps.pool_authority];
        let pool_signer: &[&[u8]] = &[b"trade_finance", b"pool_usdc", &pool_bump];
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_token_account.to_account_info(),
                    to: ctx.accounts.deal_token_account.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
            )
            .with_signer(&[pool_signer]),
            funding_amount,
        )?;
        ctx.accounts.pool_token_account.reload()?;

        let pool = &mut ctx.accounts.pool_state;
        pool.total_assets = pool
            .total_assets
            .checked_sub(funding_amount)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.active_capital = pool
            .active_capital
            .checked_add(funding_amount)
            .ok_or(TradeFinanceError::MathOverflow)?;
        let vault_amount = ctx.accounts.pool_token_account.amount;
        let lp_supply = ctx.accounts.lp_mint.supply;
        pool.nav = pool.calculate_nav(vault_amount, pool.active_capital, lp_supply)?;

        let deal = &mut ctx.accounts.deal;
        deal.status = deal_status::FUNDED;

        emit!(FundedEvent {
            trade_id,
            amount: funding_amount,
        });

        msg!(
            "deal {} funded: {} USDC recorded as active capital",
            deal.id,
            funding_amount
        );
        Ok(())
    }

    /// 管理员标记违约：清算 30% 抵押金并触发保险基金赔付。
    pub fn default_deal(ctx: Context<DefaultDeal>, trade_id: u64) -> Result<()> {
        require!(
            ctx.accounts.pool_state.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        require!(
            ctx.accounts.deal.id == trade_id,
            TradeFinanceError::TradeNotFound
        );
        require!(
            matches!(
                ctx.accounts.deal.status,
                deal_status::FUNDED..=deal_status::DELIVERED
            ),
            TradeFinanceError::InvalidStateTransition
        );

        let down_payment = ctx.accounts.deal.down_payment;
        let pool_portion = ctx.accounts.deal.pool_portion;
        let insurance_payout = ctx
            .accounts
            .deal
            .pool_portion
            .checked_mul(INSURANCE_PAYOUT_PCT_BPS)
            .ok_or(TradeFinanceError::MathOverflow)?
            / BPS_BASE;

        require!(
            ctx.accounts.pool_state.insurance_fund >= insurance_payout,
            TradeFinanceError::InsufficientInsuranceFund
        );

        // 1) 30% 抵押金清算：订单托管 -> 资金池
        let trade_id_bytes = trade_id.to_le_bytes();
        let deal_bump = [ctx.bumps.deal];
        let deal_signer: &[&[u8]] = &[
            b"trade_finance",
            b"deal",
            ctx.accounts.deal.buyer.as_ref(),
            &trade_id_bytes,
            &deal_bump,
        ];
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.deal_token_account.to_account_info(),
                    to: ctx.accounts.pool_token_account.to_account_info(),
                    authority: ctx.accounts.deal.to_account_info(),
                },
            )
            .with_signer(&[deal_signer]),
            down_payment,
        )?;

        // 2) 保险基金赔付：资金池 -> 订单托管
        let pool_bump = [ctx.bumps.pool_authority];
        let pool_signer: &[&[u8]] = &[b"trade_finance", b"pool_usdc", &pool_bump];
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_token_account.to_account_info(),
                    to: ctx.accounts.deal_token_account.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
            )
            .with_signer(&[pool_signer]),
            insurance_payout,
        )?;
        ctx.accounts.pool_token_account.reload()?;

        let clock = Clock::get()?;
        let deal = &mut ctx.accounts.deal;
        deal.status = deal_status::DEFAULTED;
        deal.repaid_at = clock.unix_timestamp;

        let pool = &mut ctx.accounts.pool_state;
        pool.insurance_fund = pool
            .insurance_fund
            .checked_sub(insurance_payout)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.total_assets = pool
            .total_assets
            .checked_sub(down_payment)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.active_capital = pool
            .active_capital
            .checked_sub(pool_portion)
            .ok_or(TradeFinanceError::MathOverflow)?;
        let vault_amount = ctx.accounts.pool_token_account.amount;
        let lp_supply = ctx.accounts.lp_mint.supply;
        pool.nav = pool.calculate_nav(vault_amount, pool.active_capital, lp_supply)?;

        msg!(
            "deal {} defaulted: liquidated {} USDC collateral, insurance payout {} USDC",
            deal.id,
            down_payment,
            insurance_payout
        );
        Ok(())
    }

    /// 买方还款：支付平台费用，LP 分红暂存资金池并回笼本金。
    pub fn repay_deal(ctx: Context<RepayDeal>, trade_id: u64) -> Result<()> {
        let deal = &ctx.accounts.deal;
        require!(
            deal.id == trade_id,
            TradeFinanceError::TradeNotFound
        );
        require!(
            deal.status == deal_status::REPAYING,
            TradeFinanceError::DealNotRepaying
        );

        let amount = deal.amount;
        let pool_portion = deal.pool_portion;
        let fee = amount
            .checked_mul(FEE_PCT_BPS)
            .ok_or(TradeFinanceError::MathOverflow)?
            / BPS_BASE;
        let platform_part = fee
            .checked_mul(PLATFORM_FEE_PCT_BPS)
            .ok_or(TradeFinanceError::MathOverflow)?
            / BPS_BASE;
        let buyer_rebate = fee
            .checked_mul(BUYER_REBATE_PCT_BPS)
            .ok_or(TradeFinanceError::MathOverflow)?
            / BPS_BASE;
        let lp_dividend = fee
            .checked_mul(LP_DIVIDEND_PCT_BPS)
            .ok_or(TradeFinanceError::MathOverflow)?
            / BPS_BASE;

        let repayment_total = pool_portion
            .checked_add(platform_part)
            .ok_or(TradeFinanceError::MathOverflow)?;
        require!(
            ctx.accounts.buyer_token_account.amount >= repayment_total,
            TradeFinanceError::InsufficientFunds
        );

        // 本金 70% 回笼资金池 vault；费用中平台部分实时转入运营钱包。
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_token_account.to_account_info(),
                    to: ctx.accounts.pool_token_account.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            pool_portion,
        )?;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_token_account.to_account_info(),
                    to: ctx.accounts.platform_token_account.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            platform_part,
        )?;
        ctx.accounts.pool_token_account.reload()?;

        let pool = &mut ctx.accounts.pool_state;
        pool.add_pending_dividends(lp_dividend)?;
        pool.total_assets = pool
            .total_assets
            .checked_add(pool_portion)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.active_capital = pool
            .active_capital
            .checked_sub(pool_portion)
            .ok_or(TradeFinanceError::MathOverflow)?;
        let vault_amount = ctx.accounts.pool_token_account.amount;
        let lp_supply = ctx.accounts.lp_mint.supply;
        pool.nav = pool.calculate_nav(vault_amount, pool.active_capital, lp_supply)?;

        let clock = Clock::get()?;
        let deal = &mut ctx.accounts.deal;
        deal.status = deal_status::SETTLED;
        deal.repaid_at = clock.unix_timestamp;

        msg!(
            "Fee distributed - Platform: {}, Rebate: {}, LP: {}",
            platform_part,
            buyer_rebate,
            lp_dividend
        );
        Ok(())
    }

    /// 管理员推进物流状态：Funded -> InTransit -> CustomsClear -> Delivered。
    pub fn advance_deal(
        ctx: Context<AdvanceDeal>,
        trade_id: u64,
        target_status: u8,
    ) -> Result<()> {
        require!(
            ctx.accounts.pool_state.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        require!(
            ctx.accounts.deal.id == trade_id,
            TradeFinanceError::TradeNotFound
        );
        validate_advance(ctx.accounts.deal.status, target_status)?;

        let deal = &mut ctx.accounts.deal;
        deal.status = target_status;

        emit!(DealStatusChangedEvent {
            trade_id,
            status: target_status,
        });
        msg!("deal {} advanced to status {}", trade_id, target_status);
        Ok(())
    }

    /// 管理员在交付确认后释放托管资金给卖方，订单进入还款期。
    pub fn release_to_seller(ctx: Context<ReleaseToSeller>, trade_id: u64) -> Result<()> {
        require!(
            ctx.accounts.pool_state.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        require!(
            ctx.accounts.deal.id == trade_id,
            TradeFinanceError::TradeNotFound
        );
        require!(
            ctx.accounts.deal.status == deal_status::DELIVERED,
            TradeFinanceError::DealNotDelivered
        );

        let release_amount = ctx.accounts.deal.amount;
        let trade_id_bytes = trade_id.to_le_bytes();
        let deal_bump = [ctx.bumps.deal];
        let deal_signer: &[&[u8]] = &[
            b"trade_finance",
            b"deal",
            ctx.accounts.deal.buyer.as_ref(),
            &trade_id_bytes,
            &deal_bump,
        ];
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.deal_token_account.to_account_info(),
                    to: ctx.accounts.seller_token_account.to_account_info(),
                    authority: ctx.accounts.deal.to_account_info(),
                },
            )
            .with_signer(&[deal_signer]),
            release_amount,
        )?;

        let deal = &mut ctx.accounts.deal;
        deal.status = deal_status::REPAYING;

        emit!(ReleasedEvent {
            trade_id,
            amount: release_amount,
        });
        msg!(
            "deal {} released {} USDC to seller",
            trade_id,
            release_amount
        );
        Ok(())
    }

    /// 刷新链上 NAV：(资金池闲置余额 + 未偿还贸易净值) / LP 代币总供应量。
    pub fn refresh_nav(ctx: Context<RefreshNav>) -> Result<()> {
        require!(
            ctx.accounts.pool_state.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        let pool = &mut ctx.accounts.pool_state;
        let vault_amount = ctx.accounts.pool_token_account.amount;
        let lp_supply = ctx.accounts.lp_mint.supply;
        pool.nav = pool.calculate_nav(vault_amount, pool.active_capital, lp_supply)?;
        msg!("pool nav refreshed: {}", pool.nav);
        Ok(())
    }
}

// ==== 分段标识: 账户约束 ====
#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = admin,
        space = PoolState::space(),
        seeds = [b"trade_finance", b"pool" as &[u8]],
        bump
    )]
    pub pool_state: Account<'info, PoolState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetPoolInfo<'info> {
    #[account(seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,
}

#[derive(Accounts)]
#[instruction(trade_id: u64, file_hash: [u8; 32], uri: String)]
pub struct AttestDocument<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = DocumentRecord::space(),
        seeds = [
            b"trade_finance",
            b"document" as &[u8],
            trade_id.to_le_bytes().as_ref(),
            file_hash.as_ref()
        ],
        bump
    )]
    pub document: Account<'info, DocumentRecord>,

    /// CHECK: 可选订单账户，用于校验单据归属（0 或未提供 trade_id 时可跳过）。
    pub deal: Option<Account<'info, TradeDeal>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u64, seller: Pubkey, amount: u64, tenor_days: u64)]
pub struct CreateDeal<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        init,
        payer = buyer,
        space = TradeDeal::space(),
        seeds = [
            b"trade_finance",
            b"deal" as &[u8],
            buyer.key().as_ref(),
            id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub deal: Account<'info, TradeDeal>,

    #[account(
        mut,
        constraint = buyer_token_account.owner == buyer.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = buyer_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = deal_token_account.owner == deal.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = deal_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub deal_token_account: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(trade_id: u64)]
pub struct FundDeal<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: 买方公钥用于推导订单 PDA。
    pub buyer: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"trade_finance",
            b"deal" as &[u8],
            buyer.key().as_ref(),
            trade_id.to_le_bytes().as_ref()
        ],
        bump,
        constraint = deal.buyer == buyer.key() @ TradeFinanceError::Unauthorized
    )]
    pub deal: Account<'info, TradeDeal>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        constraint = pool_token_account.owner == pool_authority.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = pool_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = deal_token_account.owner == deal.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = deal_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub deal_token_account: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub lp_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
#[instruction(trade_id: u64, target_status: u8)]
pub struct AdvanceDeal<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: 买方公钥用于推导订单 PDA。
    pub buyer: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"trade_finance",
            b"deal" as &[u8],
            buyer.key().as_ref(),
            trade_id.to_le_bytes().as_ref()
        ],
        bump,
        constraint = deal.buyer == buyer.key() @ TradeFinanceError::Unauthorized
    )]
    pub deal: Account<'info, TradeDeal>,
}

#[derive(Accounts)]
#[instruction(trade_id: u64)]
pub struct ReleaseToSeller<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: 买方公钥用于推导订单 PDA。
    pub buyer: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"trade_finance",
            b"deal" as &[u8],
            buyer.key().as_ref(),
            trade_id.to_le_bytes().as_ref()
        ],
        bump,
        constraint = deal.buyer == buyer.key() @ TradeFinanceError::Unauthorized
    )]
    pub deal: Account<'info, TradeDeal>,

    #[account(
        mut,
        constraint = deal_token_account.owner == deal.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = deal_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub deal_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = seller_token_account.owner == deal.seller @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = seller_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefreshNav<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        constraint = pool_token_account.owner == pool_authority.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = pool_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    pub lp_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
#[instruction(trade_id: u64)]
pub struct RepayDeal<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"trade_finance",
            b"deal" as &[u8],
            buyer.key().as_ref(),
            trade_id.to_le_bytes().as_ref()
        ],
        bump,
        constraint = deal.buyer == buyer.key() @ TradeFinanceError::Unauthorized,
        constraint = deal.status == deal_status::REPAYING @ TradeFinanceError::DealNotRepaying
    )]
    pub deal: Account<'info, TradeDeal>,

    #[account(
        mut,
        constraint = buyer_token_account.owner == buyer.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = buyer_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = platform_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint,
        constraint = platform_token_account.owner == pool_state.platform_wallet @ TradeFinanceError::WrongTokenAccountOwner
    )]
    pub platform_token_account: Account<'info, TokenAccount>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(mut, seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        constraint = pool_token_account.owner == pool_authority.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = pool_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub lp_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct DepositPool<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        constraint = depositor_token_account.owner == depositor.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = depositor_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        constraint = pool_token_account.owner == pool_authority.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = pool_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub lp_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct RedeemLp<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub lp_user: Signer<'info>,

    #[account(
        mut,
        constraint = lp_user_token_account.owner == lp_user.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = lp_user_token_account.mint == lp_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub lp_user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = lp_user_usdc_token_account.owner == lp_user.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = lp_user_usdc_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub lp_user_usdc_token_account: Account<'info, TokenAccount>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        constraint = pool_token_account.owner == pool_authority.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = pool_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    #[account(mut)]
    pub lp_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(trade_id: u64)]
pub struct DefaultDeal<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: 买方公钥用于推导订单 PDA。
    pub buyer: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"trade_finance",
            b"deal" as &[u8],
            buyer.key().as_ref(),
            trade_id.to_le_bytes().as_ref()
        ],
        bump,
        constraint = deal.buyer == buyer.key() @ TradeFinanceError::Unauthorized
    )]
    pub deal: Account<'info, TradeDeal>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        constraint = pool_token_account.owner == pool_authority.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = pool_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = deal_token_account.owner == deal.key() @ TradeFinanceError::WrongTokenAccountOwner,
        constraint = deal_token_account.mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub deal_token_account: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub lp_mint: Account<'info, Mint>,
}
