use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};


use crate::state::{
    LP_MINT_DECIMALS, ADMIN_TRANSFER_DELAY_SECS, MIN_ADMIN_DELAY_SECS, USDC_DECIMALS_FACTOR,
    DEFAULT_FEE_APY_BPS, DEFAULT_LP_SHARE_BPS, DEFAULT_PLATFORM_SHARE_BPS, DEFAULT_REBATE_SHARE_BPS,
    DEFAULT_MIN_INSURANCE_ABS,
    MAX_SINGLE_FEE_BPS, MIN_FIRST_LOSS_ABS,
};

use crate::error::TradeFinanceError;
use crate::state::{
    deal_status, DocumentRecord, MAX_DOCUMENT_URI_LEN, PoolState, RebateRecord, TradeDeal,
    DividendClaim,
};

declare_id!("9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3");

/// 部署方白名单（审计 H-01/N-05）：仅允许该地址（或程序的 upgrade authority）初始化。
/// 测试/CI 由 scripts/test.sh 动态替换为当前部署钱包；主网构建前必须替换为部署冷钱包地址。
pub const DEPLOYER: Pubkey = pubkey!("3rF9fK7KL2YmAsdGHFrsGTZHiKrqF7BRCZ88KRZ3nsK8");

pub mod error;
pub mod events;
pub mod state;

use events::*;

// ==== 分段标识: 业务常量 ====
/// 首付比例，3000 bps = 30.00%。
pub const DOWN_PAYMENT_BPS: u64 = 3000;
/// 万分位基数，用于 bps 换算。
pub const BPS_BASE: u64 = 10_000;
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
    pub paused: bool,
    pub usdc_mint: Pubkey,
    pub lp_mint: Pubkey,
    pub escrow_funded: u64,
    pub redemption_price: u64,
    pub redeem_window_epoch: i64,
    pub redeem_window_used: u64,
    pub pending_admin: Pubkey,
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
        initial_delay_secs: i64,
    ) -> Result<()> {
        // 审计 H-01 / N-05：仅允许部署方初始化，杜绝抢先初始化抢跑。
        // 规则：若程序保留 upgrade authority（主网部署常态），初始化者必须等于
        // upgrade authority（部署冷钱包），硬编码 DEPLOYER 不生效；
        // 仅当 upgrade authority 已被冻结（None，如 anchor test 部署）时，
        // 回退到编译期 DEPLOYER 白名单。
        // 原生 ProgramData 布局（agave 4.1.2 实测）：
        //   offset 0: u32 状态（ProgramData 固定 3）
        //   offset 4: u64 slot
        //   offset 12: u8 升级权限存在标记（1=有）
        //   offset 13: Pubkey upgrade_authority
        let pd_data = ctx.accounts.program_data.try_borrow_data()?;
        let ua_tag = u8::from_le_bytes(
            pd_data[12..13].try_into().map_err(|_| TradeFinanceError::Unauthorized)?,
        );
        let upgrade_authority = if ua_tag == 1 {
            let ua = Pubkey::new_from_array(
                pd_data[13..45]
                    .try_into()
                    .map_err(|_| TradeFinanceError::Unauthorized)?,
            );
            // 全零公钥（SystemProgram 占位，anchor test --bpf-program 预加载、
            // 或 agave 占位）不可签名，视为无有效升级权限，回退 DEPLOYER 白名单。
            if ua == Pubkey::default() { None } else { Some(ua) }
        } else {
            None
        };
        let allowed = match upgrade_authority {
            Some(ua) => ua == ctx.accounts.admin.key(),
            None => ctx.accounts.admin.key() == DEPLOYER,
        };
        require!(allowed, TradeFinanceError::Unauthorized);
        // 审计 C-01：LP mint authority 必须是 pool_authority PDA（链上铸币的前提）。
        require!(
            ctx.accounts.lp_mint.mint_authority == COption::Some(ctx.accounts.pool_authority.key()),
            TradeFinanceError::InvalidLpMintAuthority
        );
        // 审计 C-01 / M-09：不允许存在 freeze authority（防止冻结 LP 账户阻断赎回）。
        require!(
            ctx.accounts.lp_mint.freeze_authority.is_none(),
            TradeFinanceError::InvalidLpMintFreezeAuthority
        );
        // 审计 L-05：LP mint 精度必须与协议约定一致。
        require!(
            ctx.accounts.lp_mint.decimals == LP_MINT_DECIMALS,
            TradeFinanceError::InvalidMintDecimals
        );

        let pool = &mut ctx.accounts.pool_state;
        pool.admin = ctx.accounts.admin.key();
        pool.platform_wallet = platform_wallet;
        pool.total_assets = 0;
        pool.active_capital = 0;
        pool.reserve_fund = 0;
        pool.insurance_fund = 0;
        pool.pending_dividends = 0;
        pool.nav = 0;
        pool.usdc_mint = ctx.accounts.usdc_mint.key();
        pool.lp_mint = ctx.accounts.lp_mint.key();
        pool.escrow_funded = 0;
        pool.redemption_price = 0;
        pool.redeem_window_epoch = 0;
        pool.redeem_window_used = 0;
        pool.pending_admin = Pubkey::default();
        pool.pending_admin_proposed_at = 0;
        pool.fee_apy_bps = DEFAULT_FEE_APY_BPS;
        pool.lp_share_bps = DEFAULT_LP_SHARE_BPS;
        pool.platform_share_bps = DEFAULT_PLATFORM_SHARE_BPS;
        pool.rebate_share_bps = DEFAULT_REBATE_SHARE_BPS;
        pool.first_loss_reserve = 0;
        pool.min_insurance_abs = DEFAULT_MIN_INSURANCE_ABS;
        pool.overdue_fee_apy_bps = 0;
        // 审计 H-05：初始时锁由部署方注入（生产 172_800s，测试可注入小值验证锁定期行为）。
        require!(initial_delay_secs >= 0, TradeFinanceError::InvalidFeeParams);
        pool.pending_admin_delay_secs = initial_delay_secs;

        msg!("pool initialized by {}", pool.admin);
        Ok(())
    }

    /// 紧急暂停/恢复资金池：管理员可随时冻结全部资金移动指令。
    /// 暂停后 get_pool_info / refresh_nav / attest_document 等只读与存证
    /// 仍可用，但建单/存款/放款/推进/释放/还款/违约/赎回/分红一律拒绝。
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        let pool = &mut ctx.accounts.pool_state;
        require!(
            pool.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        pool.paused = paused;
        emit!(PoolPausedEvent {
            admin: ctx.accounts.admin.key(),
            paused,
        });
        msg!(
            "pool {} by {}",
            if paused { "paused" } else { "resumed" },
            pool.admin
        );
        Ok(())
    }

    /// 管理员轮换第一步：提出转移提案（审计 H-03 两步轮换）。
    /// 由新管理员签名接受后生效（见 accept_admin）。
    pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
        let pool = &mut ctx.accounts.pool_state;
        require!(
            pool.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        require!(
            new_admin != Pubkey::default(),
            TradeFinanceError::InvalidNewAdmin
        );
        require!(
            pool.pending_admin == Pubkey::default(),
            TradeFinanceError::PendingAdminExists
        );
        let old_admin = pool.admin;
        pool.pending_admin = new_admin;
        pool.pending_admin_proposed_at = Clock::get()?.unix_timestamp;
        emit!(AdminTransferProposedEvent {
            old_admin,
            new_admin,
            proposed_at: pool.pending_admin_proposed_at,
        });
        msg!("admin transfer proposed: {} -> {}", old_admin, new_admin);
        Ok(())
    }

    /// 管理员轮换第二步：新管理员签名接受，锁定期结束后生效（审计 H-03）。
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let pool = &mut ctx.accounts.pool_state;
        require!(
            pool.pending_admin == ctx.accounts.new_admin.key(),
            TradeFinanceError::Unauthorized
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= pool
                .pending_admin_proposed_at
                .checked_add(pool.pending_admin_delay_secs)
                .ok_or(TradeFinanceError::MathOverflow)?,
            TradeFinanceError::AdminLockNotElapsed
        );
        let old_admin = pool.admin;
        let new_admin = pool.pending_admin;
        pool.admin = new_admin;
        pool.pending_admin = Pubkey::default();
        pool.pending_admin_proposed_at = 0;
        emit!(AdminTransferredEvent {
            old_admin,
            new_admin,
        });
        msg!("admin transferred: {} -> {}", old_admin, new_admin);
        Ok(())
    }

    /// 更新平台运营钱包（手续费收款地址），防止运营钱包轮换需重部署。
    pub fn set_platform_wallet(
        ctx: Context<SetPlatformWallet>,
        platform_wallet: Pubkey,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool_state;
        require!(
            pool.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        require!(
            platform_wallet != Pubkey::default(),
            TradeFinanceError::InvalidPlatformWallet
        );
        pool.platform_wallet = platform_wallet;
        emit!(PlatformWalletUpdatedEvent {
            admin: ctx.accounts.admin.key(),
            platform_wallet,
        });
        msg!("platform wallet updated: {}", platform_wallet);
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
            paused: pool.paused,
            usdc_mint: pool.usdc_mint,
            lp_mint: pool.lp_mint,
            escrow_funded: pool.escrow_funded,
            redemption_price: pool.redemption_price,
            redeem_window_epoch: pool.redeem_window_epoch,
            redeem_window_used: pool.redeem_window_used,
            pending_admin: pool.pending_admin,
        })
    }

    /// 单据存证：把文件 SHA-256 哈希写入独立 PDA，供审计与溯源。
    pub fn attest_document(
        ctx: Context<AttestDocument>,
        trade_id: u64,
        file_hash: [u8; 32],
        uri: String,
    ) -> Result<()> {
        // 审计 L-06：暂停期间冻结存证写入。
        ctx.accounts.pool_state.ensure_not_paused()?;
        require!(
            !uri.is_empty() && uri.len() <= MAX_DOCUMENT_URI_LEN,
            TradeFinanceError::InvalidDocumentUri
        );

        // 审计 M-06：订单为必选，且必须与单据命名空间（买方）匹配。
        let deal = &ctx.accounts.deal;
        require!(
            deal.id == trade_id,
            TradeFinanceError::TradeNotFound
        );
        require!(
            ctx.accounts.owner.key() == deal.buyer
                || ctx.accounts.owner.key() == deal.seller,
            TradeFinanceError::InvalidDocumentOwner
        );

        let clock = Clock::get()?;
        let owner = ctx.accounts.owner.key();
        let document = &mut ctx.accounts.document;
        document.trade_id = trade_id;
        document.owner = owner;
        document.file_hash = file_hash;
        document.uri = uri.clone();
        document.uploaded_at = clock.unix_timestamp;

        emit!(DocumentAttestedEvent {
            trade_id,
            owner,
            file_hash,
            uri,
            uploaded_at: clock.unix_timestamp,
        });

        msg!("document attested: trade_id={}", trade_id);
        Ok(())
    }

    /// 创建贸易订单：校验账期与 1% 集中度，买方 30% 首付实际转入订单托管。
    pub fn create_deal(
        ctx: Context<CreateDeal>,
        id: u64,
        seller: Pubkey,
        amount: u64,
        tenor_days: u64,
    ) -> Result<()> {
        ctx.accounts.pool_state.ensure_not_paused()?;
        require!(amount > 0, TradeFinanceError::InvalidAmount);
        require!(
            matches!(tenor_days, 30 | 60 | 90 | 120),
            TradeFinanceError::InvalidTenor
        );

        // 审计 M-07：禁止自融资闭环（卖方不得为买方自身或全零地址）。
        require!(
            seller != ctx.accounts.buyer.key(),
            TradeFinanceError::SelfDealing
        );
        require!(
            seller != Pubkey::default(),
            TradeFinanceError::InvalidSeller
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

        // 审计 M-08：集中度上限基于资金池可用流动性（vault - 保险 - 待分红），
        // 而非包含买方托管的 total_assets。
        let available = ctx
            .accounts
            .pool_token_account
            .amount
            .saturating_sub(ctx.accounts.pool_state.insurance_fund)
            .saturating_sub(ctx.accounts.pool_state.pending_dividends);
        let concentration_limit = available / 100;
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
        deal.set_status(deal_status::PENDING)?;
        deal.created_at = clock.unix_timestamp;
        deal.repaid_at = 0;

        let pool = &mut ctx.accounts.pool_state;
        pool.total_assets = pool
            .total_assets
            .checked_add(down_payment)
            .ok_or(TradeFinanceError::MathOverflow)?;

        emit!(DealCreatedEvent {
            trade_id: deal.id,
            buyer: deal.buyer,
            seller: deal.seller,
            amount: deal.amount,
        });

        msg!(
            "deal {} created: buyer={}, seller={}, amount={}",
            deal.id,
            deal.buyer,
            deal.seller,
            deal.amount
        );
        Ok(())
    }

    /// LP 存入稳定币：按 80%/20% 计入风险准备金与保险基金，
    /// 并在同一指令内按当期 NAV 链上铸造 LP 份额（审计 C-01）。
    pub fn deposit_pool(ctx: Context<DepositPool>, amount: u64) -> Result<()> {
        ctx.accounts.pool_state.ensure_not_paused()?;
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
        let vault_before_deposit = ctx
            .accounts
            .pool_token_account
            .amount
            .checked_sub(amount)
            .ok_or(TradeFinanceError::MathOverflow)?;
        let lp_supply = ctx.accounts.lp_mint.supply;

        // 审计 C-01：份额发行收归合约控制——首笔按 1 USDC = 1 LP（显示单位），
        // 后续按池子总价值定价。
        let shares = if lp_supply == 0 {
            amount / USDC_DECIMALS_FACTOR
        } else {
            // 审计 N-01/N-06：铸币定价与赎回一致，采用纯现金权益基准
            // （equity_base = vault - first_loss，不含应收），消除铸造/赎回套利。
            let nav_base = pool.equity_base(vault_before_deposit)?;
            require!(nav_base > 0, TradeFinanceError::MathOverflow);
            ((amount as u128)
                .checked_mul(lp_supply as u128)
                .ok_or(TradeFinanceError::MathOverflow)?
                / nav_base as u128) as u64
        };
        require!(shares > 0, TradeFinanceError::ZeroShareMint);

        let pool_bump = [ctx.bumps.pool_authority];
        let pool_signer: &[&[u8]] = &[b"trade_finance", b"pool_usdc", &pool_bump];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.depositor_lp_token_account.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                &[pool_signer],
            ),
            shares,
        )?;
        ctx.accounts.lp_mint.reload()?;

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
        let lp_supply_after = ctx.accounts.lp_mint.supply;
        let outstanding = pool
            .active_capital
            .checked_add(pool.escrow_funded)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.nav = pool.calculate_nav(pool.equity_base(vault_amount)?, outstanding, lp_supply_after)?;
        pool.redemption_price = pool.calculate_redemption_price(
            pool.equity_base(vault_amount)?,
            lp_supply_after,
        )?;

        emit!(DepositEvent {
            depositor: ctx.accounts.depositor.key(),
            amount,
            lp_shares: shares,
            nav: pool.nav,
            redemption_price: pool.redemption_price,
        });

        msg!(
            "pool deposit: {} USDC, {} LP minted, nav: {}",
            amount,
            shares,
            pool.nav
        );
        Ok(())
    }

    /// LP 赎回：按 NAV 换算并销毁 LP 代币，同时受单次上限与保险池保护。
    pub fn redeem_lp(ctx: Context<RedeemLp>, lp_amount: u64) -> Result<()> {
        ctx.accounts.pool_state.ensure_not_paused()?;
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

        // 审计 N-01/N-06：赎回按 LP 权益现金基准（vault - first_loss）兑付，首损不可赎回。
        let equity_before = ctx.accounts.pool_state.equity_base(vault_before)?;
        let usdc_out = ((lp_amount as u128)
            .checked_mul(equity_before as u128)
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
        // 审计 M-10：total_before 作为 reserve/insurance 按比例扣减的分母，必须 > 0。
        require!(total_before > 0, TradeFinanceError::InsufficientFunds);
        let reserve_before = pool.reserve_fund;
        let insurance_before = pool.insurance_fund;
        let total_after = total_before
            .checked_sub(usdc_out)
            .ok_or(TradeFinanceError::MathOverflow)?;
        // 流动性保护：赎回后 vault 现金必须仍 >= 在途应收
        // （active_capital + escrow_funded，审计 M-01 语义修正 + L1）。
        let outstanding = pool
            .active_capital
            .checked_add(pool.escrow_funded)
            .ok_or(TradeFinanceError::MathOverflow)?;
        let vault_after = vault_before
            .checked_sub(usdc_out)
            .ok_or(TradeFinanceError::MathOverflow)?;
        require!(
            vault_after >= outstanding,
            TradeFinanceError::InsufficientFunds
        );
        // H-04：首损资金不可被 LP 赎回。
        require!(
            vault_after >= pool.first_loss_reserve,
            TradeFinanceError::InsufficientFunds
        );
        require!(
            outstanding <= total_after,
            TradeFinanceError::InsufficientFunds
        );

        // 审计 M-05：周期累计赎回上限（当前窗口内 used + usdc_out <= vault * 50%）。
        let now = Clock::get()?.unix_timestamp;
        let current_window = pool.current_redeem_window(now);
        if pool.redeem_window_epoch != current_window {
            pool.redeem_window_epoch = current_window;
            pool.redeem_window_used = 0;
        }
        let window_cap = ((vault_before as u128)
            .checked_mul(MAX_REDEEM_BPS as u128)
            .ok_or(TradeFinanceError::MathOverflow)?
            / BPS_BASE as u128) as u64;
        let window_after = pool
            .redeem_window_used
            .checked_add(usdc_out)
            .ok_or(TradeFinanceError::MathOverflow)?;
        require!(
            window_after <= window_cap,
            TradeFinanceError::RedeemWindowExceeded
        );
        pool.redeem_window_used = window_after;

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
            insurance_after >= pool.min_insurance_abs,
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
        ctx.accounts.lp_mint.reload()?;
        pool.total_assets = total_after;
        pool.reserve_fund = reserve_before
            .checked_sub(reserve_out)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.insurance_fund = insurance_after;
        let vault_after = ctx.accounts.pool_token_account.amount;
        let lp_supply_after = ctx.accounts.lp_mint.supply;
        let outstanding = pool
            .active_capital
            .checked_add(pool.escrow_funded)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.nav = pool.calculate_nav(pool.equity_base(vault_after)?, outstanding, lp_supply_after)?;
        // 审计 M-04 + H-04：维护赎回定价（剔除首损后的 LP 可赎回现金 / supply）。
        pool.redemption_price = pool.calculate_redemption_price(
            pool.equity_base(vault_after)?,
            lp_supply_after,
        )?;

        emit!(RedeemedEvent {
            lp_user: ctx.accounts.lp_user.key(),
            lp_amount,
            usdc_out,
            nav: pool.nav,
            redemption_price: pool.redemption_price,
        });

        msg!(
            "redeemed {} LP for {} USDC by {}",
            lp_amount,
            usdc_out,
            ctx.accounts.lp_user.key()
        );
        Ok(())
    }

    /// 管理员放款：资金池 vault 转入订单托管，active_capital 记账。
    pub fn fund_deal(ctx: Context<FundDeal>, trade_id: u64) -> Result<()> {
        ctx.accounts.pool_state.ensure_not_paused()?;
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
        // 审计 M-03：放款后金库现金不得低于保险基金账面，确保保险赔付有现金支撑。
        let vault_after = ctx.accounts.pool_token_account.amount;
        require!(
            vault_after >= pool.insurance_fund,
            TradeFinanceError::InsuranceFundNotBacked
        );
        // 审计 M-01：垫付计入 escrow_funded（在途托管），不再重复计入 active_capital。
        pool.escrow_funded = pool
            .escrow_funded
            .checked_add(funding_amount)
            .ok_or(TradeFinanceError::MathOverflow)?;
        let lp_supply = ctx.accounts.lp_mint.supply;
        let outstanding = pool
            .active_capital
            .checked_add(pool.escrow_funded)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.nav = pool.calculate_nav(pool.equity_base(vault_after)?, outstanding, lp_supply)?;

        let deal = &mut ctx.accounts.deal;
        deal.set_status(deal_status::FUNDED)?;

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
        ctx.accounts.pool_state.ensure_not_paused()?;
        require!(
            ctx.accounts.pool_state.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        require!(
            ctx.accounts.deal.id == trade_id,
            TradeFinanceError::TradeNotFound
        );
        let deal_status_value = ctx.accounts.deal.status;
        if matches!(
            deal_status_value,
            deal_status::FUNDED..=deal_status::DELIVERED
        ) {
            // 融资与物流阶段可由管理员直接判定违约。
        } else if deal_status_value == deal_status::REPAYING {
            // 还款期仅允许账期已到期的订单违约。
            let now = Clock::get()?.unix_timestamp;
            require!(
                ctx.accounts.deal.is_expired(now)?,
                TradeFinanceError::DealNotExpired
            );
        } else {
            return Err(TradeFinanceError::InvalidStateTransition.into());
        }

        let released = deal_status_value == deal_status::REPAYING;
        let down_payment = ctx.accounts.deal.down_payment;
        let pool_portion = ctx.accounts.deal.pool_portion;
        let insurance_payout = ctx
            .accounts
            .deal
            .pool_portion
            .checked_mul(INSURANCE_PAYOUT_PCT_BPS)
            .ok_or(TradeFinanceError::MathOverflow)?
            / BPS_BASE;

        if released {
            // 托管已释放给卖方，买方违约时保险基金补偿资金池损失。
            require!(
                ctx.accounts.pool_state.insurance_fund >= insurance_payout,
                TradeFinanceError::InsufficientInsuranceFund
            );
        } else {
            // 托管仍持有 30% 抵押金 + 70% 垫付款：整笔收回资金池，
            // 资金池收回本金并清算买方抵押金，无需动用保险基金。
            let recovered = down_payment
                .checked_add(pool_portion)
                .ok_or(TradeFinanceError::MathOverflow)?;
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
                recovered,
            )?;
            ctx.accounts.pool_token_account.reload()?;
        }

        let clock = Clock::get()?;
        let deal = &mut ctx.accounts.deal;
        deal.set_status(deal_status::DEFAULTED)?;
        deal.repaid_at = clock.unix_timestamp;

        let pool = &mut ctx.accounts.pool_state;
        if released {
            // 还款期违约：应收核销；保险赔付为保险基金内部消解（不虚增 total_assets，审计 M-02）。
            pool.insurance_fund = pool
                .insurance_fund
                .checked_sub(insurance_payout)
                .ok_or(TradeFinanceError::MathOverflow)?;
            // H-04 首损层：剩余损失先由平台首损资金承担（真实补偿 LP）。
            let remaining_loss = pool_portion
                .checked_sub(insurance_payout)
                .ok_or(TradeFinanceError::MathOverflow)?;
            let first_loss_used = remaining_loss.min(pool.first_loss_reserve);
            pool.first_loss_reserve = pool
                .first_loss_reserve
                .checked_sub(first_loss_used)
                .ok_or(TradeFinanceError::MathOverflow)?;
            // 应收全额核销（-P），首损承担部分回补总资产（+first_loss_used）。
            pool.total_assets = pool
                .total_assets
                .checked_sub(pool_portion)
                .ok_or(TradeFinanceError::MathOverflow)?
                .checked_add(first_loss_used)
                .ok_or(TradeFinanceError::MathOverflow)?;
            pool.active_capital = pool
                .active_capital
                .checked_sub(pool_portion)
                .ok_or(TradeFinanceError::MathOverflow)?;
        } else {
            // 未释放违约：托管整笔回池，在途垫付消除（审计 M-01）。
            pool.escrow_funded = pool
                .escrow_funded
                .checked_sub(pool_portion)
                .ok_or(TradeFinanceError::MathOverflow)?;
        }
        let outstanding = pool
            .active_capital
            .checked_add(pool.escrow_funded)
            .ok_or(TradeFinanceError::MathOverflow)?;
        let vault_amount = ctx.accounts.pool_token_account.amount;
        let lp_supply = ctx.accounts.lp_mint.supply;
        pool.nav = pool.calculate_nav(pool.equity_base(vault_amount)?, outstanding, lp_supply)?;

        emit!(DefaultEvent {
            trade_id,
            status: deal_status::DEFAULTED,
            recovered: if released { 0 } else { down_payment + pool_portion },
            insurance_payout: if released { insurance_payout } else { 0 },
        });

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
        ctx.accounts.pool_state.ensure_not_paused()?;
        let deal = &ctx.accounts.deal;
        require!(
            deal.id == trade_id,
            TradeFinanceError::TradeNotFound
        );
        require!(
            deal.status == deal_status::REPAYING,
            TradeFinanceError::DealNotRepaying
        );

        let pool_portion = deal.pool_portion;
        // H-04：fee = P × fee_apy_bps × tenor / (10000 × 365 × 86400)。
        let pool_ref = &ctx.accounts.pool_state;
        let fee = ((pool_portion as u128)
            .checked_mul(pool_ref.fee_apy_bps as u128)
            .ok_or(TradeFinanceError::MathOverflow)?
            .checked_mul(deal.tenor as u128)
            .ok_or(TradeFinanceError::MathOverflow)?
            / (BPS_BASE as u128 * 365 * 86_400)) as u64;
        // H-04 D7：单笔费率上限（占垫付额）。
        let max_fee = pool_portion
            .checked_mul(MAX_SINGLE_FEE_BPS)
            .ok_or(TradeFinanceError::MathOverflow)?
            / BPS_BASE;
        require!(fee <= max_fee, TradeFinanceError::MaxFeeExceeded);
        require!(fee > 0, TradeFinanceError::InvalidAmount);
        let platform_part = fee
            .checked_mul(pool_ref.platform_share_bps)
            .ok_or(TradeFinanceError::MathOverflow)?
            / BPS_BASE;
        let buyer_rebate = fee
            .checked_mul(pool_ref.rebate_share_bps)
            .ok_or(TradeFinanceError::MathOverflow)?
            / BPS_BASE;
        let lp_dividend = fee
            .checked_mul(pool_ref.lp_share_bps)
            .ok_or(TradeFinanceError::MathOverflow)?
            / BPS_BASE;

        // 审计 L-04：逾期罚息（overdue_fee_apy_bps 默认 0 未启用；启用后按逾期天数加收）。
        let now = Clock::get()?.unix_timestamp;
        let overdue_fee = if pool_ref.overdue_fee_apy_bps > 0 {
            let deadline = deal
                .created_at
                .checked_add(deal.tenor)
                .ok_or(TradeFinanceError::MathOverflow)?;
            if now > deadline {
                let overdue_days = (now - deadline) / 86_400;
                ((pool_portion as u128)
                    .checked_mul(pool_ref.overdue_fee_apy_bps as u128)
                    .ok_or(TradeFinanceError::MathOverflow)?
                    .checked_mul(overdue_days as u128)
                    .ok_or(TradeFinanceError::MathOverflow)?
                    / (BPS_BASE as u128 * 365)) as u64
            } else {
                0
            }
        } else {
            0
        };

        let repayment_total = pool_portion
            .checked_add(fee)
            .ok_or(TradeFinanceError::MathOverflow)?
            .checked_add(overdue_fee)
            .ok_or(TradeFinanceError::MathOverflow)?;
        require!(
            ctx.accounts.buyer_token_account.amount >= repayment_total,
            TradeFinanceError::InsufficientFunds
        );

        // 买方支付本金 70% + 全额费用（2.5%）：全部先进入资金池 vault，
        // 再按比例分配平台分成与买方返利，LP 分红留在池内形成真实资金支撑。
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_token_account.to_account_info(),
                    to: ctx.accounts.pool_token_account.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            repayment_total,
        )?;
        ctx.accounts.pool_token_account.reload()?;

        let pool_bump = [ctx.bumps.pool_authority];
        let pool_signer: &[&[u8]] = &[b"trade_finance", b"pool_usdc", &pool_bump];
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_token_account.to_account_info(),
                    to: ctx.accounts.platform_token_account.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
            )
            .with_signer(&[pool_signer]),
            platform_part,
        )?;
        if buyer_rebate > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.pool_token_account.to_account_info(),
                        to: ctx.accounts.buyer_token_account.to_account_info(),
                        authority: ctx.accounts.pool_authority.to_account_info(),
                    },
                )
                .with_signer(&[pool_signer]),
                buyer_rebate,
            )?;
        }
        ctx.accounts.pool_token_account.reload()?;

        let pool = &mut ctx.accounts.pool_state;
        pool.add_pending_dividends(lp_dividend)?;
        // H-04/L-04：total_assets 按 vault 实际留存（fee - platform - rebate）记账，
        // 消除取整 dust 导致的恒等式偏差。
        let retained = fee
            .checked_sub(platform_part)
            .ok_or(TradeFinanceError::MathOverflow)?
            .checked_sub(buyer_rebate)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.total_assets = pool
            .total_assets
            .checked_add(retained)
            .ok_or(TradeFinanceError::MathOverflow)?
            .checked_add(overdue_fee)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.active_capital = pool
            .active_capital
            .checked_sub(pool_portion)
            .ok_or(TradeFinanceError::MathOverflow)?;
        let vault_amount = ctx.accounts.pool_token_account.amount;
        let lp_supply = ctx.accounts.lp_mint.supply;
        let outstanding = pool
            .active_capital
            .checked_add(pool.escrow_funded)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.nav = pool.calculate_nav(pool.equity_base(vault_amount)?, outstanding, lp_supply)?;

        let clock = Clock::get()?;
        let deal = &mut ctx.accounts.deal;
        deal.set_status(deal_status::SETTLED)?;
        deal.repaid_at = clock.unix_timestamp;

        if buyer_rebate > 0 {
            let rebate = &mut ctx.accounts.rebate;
            rebate.buyer = ctx.accounts.buyer.key();
            rebate.total_rebate = rebate
                .total_rebate
                .checked_add(buyer_rebate)
                .ok_or(TradeFinanceError::MathOverflow)?;
            emit!(BuyerRebateEvent {
                buyer: rebate.buyer,
                trade_id,
                amount: buyer_rebate,
                total: rebate.total_rebate,
            });
        }

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
        ctx.accounts.pool_state.ensure_not_paused()?;
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
        deal.set_status(target_status)?;

        emit!(DealStatusChangedEvent {
            trade_id,
            status: target_status,
        });
        msg!("deal {} advanced to status {}", trade_id, target_status);
        Ok(())
    }

    /// 管理员在交付确认后释放托管资金给卖方，订单进入还款期。
    pub fn release_to_seller(ctx: Context<ReleaseToSeller>, trade_id: u64) -> Result<()> {
        ctx.accounts.pool_state.ensure_not_paused()?;
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
        let collateral_out = ctx.accounts.deal.down_payment;
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
        deal.set_status(deal_status::REPAYING)?;

        // 买方 30% 抵押金随托管一并支付给卖方，从总资产中扣减；
        // 资金池的 70% 垫付款转为对买方的应收（active_capital）。
        let pool = &mut ctx.accounts.pool_state;
        pool.total_assets = pool
            .total_assets
            .checked_sub(collateral_out)
            .ok_or(TradeFinanceError::MathOverflow)?;
        // 审计 M-01：垫付从"在途托管"转为"应收"。
        let pool_portion = ctx.accounts.deal.pool_portion;
        pool.escrow_funded = pool
            .escrow_funded
            .checked_sub(pool_portion)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.active_capital = pool
            .active_capital
            .checked_add(pool_portion)
            .ok_or(TradeFinanceError::MathOverflow)?;

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
        let outstanding = pool
            .active_capital
            .checked_add(pool.escrow_funded)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.nav = pool.calculate_nav(pool.equity_base(vault_amount)?, outstanding, lp_supply)?;
        pool.redemption_price = pool.calculate_redemption_price(
            pool.equity_base(vault_amount)?,
            lp_supply,
        )?;
        msg!(
            "pool nav refreshed: {} (redemption price {})",
            pool.nav,
            pool.redemption_price
        );
        Ok(())
    }

    /// 管理员发放待分配 LP 分红：从资金池 vault 支付给指定接收方。
    pub fn distribute_dividends(
        ctx: Context<DistributeDividends>,
        amount: u64,
    ) -> Result<()> {
        ctx.accounts.pool_state.ensure_not_paused()?;
        require!(
            ctx.accounts.pool_state.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        require!(amount > 0, TradeFinanceError::InvalidAmount);

        let pool = &mut ctx.accounts.pool_state;
        require!(
            pool.pending_dividends >= amount,
            TradeFinanceError::InsufficientDividends
        );
        // 审计 L-11：仅允许向 LP 持有者发放分红，且单次不超过其按 LP 占比应得份额，
        // 消除管理员向任意地址定向转移/超比例倾斜的裁量权。
        let recipient_lp_balance = ctx.accounts.recipient_lp_token_account.amount;
        require!(
            recipient_lp_balance > 0,
            TradeFinanceError::InvalidAmount
        );
        let lp_supply = ctx.accounts.lp_mint.supply;
        require!(lp_supply > 0, TradeFinanceError::ZeroLpSupply);
        let share_cap = ((pool.pending_dividends as u128)
            .checked_mul(recipient_lp_balance as u128)
            .ok_or(TradeFinanceError::MathOverflow)?
            / lp_supply as u128) as u64;
        require!(amount <= share_cap, TradeFinanceError::InvalidAmount);

        let pool_bump = [ctx.bumps.pool_authority];
        let pool_signer: &[&[u8]] = &[b"trade_finance", b"pool_usdc", &pool_bump];
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_token_account.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
            )
            .with_signer(&[pool_signer]),
            amount,
        )?;
        ctx.accounts.pool_token_account.reload()?;

        pool.pending_dividends = pool
            .pending_dividends
            .checked_sub(amount)
            .ok_or(TradeFinanceError::MathOverflow)?;
        pool.total_assets = pool
            .total_assets
            .checked_sub(amount)
            .ok_or(TradeFinanceError::MathOverflow)?;
        let outstanding = pool
            .active_capital
            .checked_add(pool.escrow_funded)
            .ok_or(TradeFinanceError::MathOverflow)?;
        let vault_amount = ctx.accounts.pool_token_account.amount;
        let lp_supply = ctx.accounts.lp_mint.supply;
        pool.nav = pool.calculate_nav(pool.equity_base(vault_amount)?, outstanding, lp_supply)?;
        pool.redemption_price = pool.calculate_redemption_price(
            pool.equity_base(vault_amount)?,
            lp_supply,
        )?;

        // 审计 H-02 方案 A：更新分红领取台账，使管理员分配行为可被链上审计。
        let clock = Clock::get()?;
        let claim = &mut ctx.accounts.dividend_claim;
        claim.recipient = ctx.accounts.recipient.key();
        claim.total_claimed = claim
            .total_claimed
            .checked_add(amount)
            .ok_or(TradeFinanceError::MathOverflow)?;
        claim.last_claim_at = clock.unix_timestamp;

        emit!(DividendDistributedEvent {
            recipient: ctx.accounts.recipient.key(),
            amount,
            remaining: pool.pending_dividends,
            total_claimed: claim.total_claimed,
        });
        msg!(
            "distributed {} USDC dividends to {}; remaining {}",
            amount,
            ctx.accounts.recipient.key(),
            pool.pending_dividends
        );
        Ok(())
    }

    /// 更新 LP Mint（审计 M-09）：仅允许在资金池暂停、无在途敞口、旧供应量为 0 时执行。
    pub fn set_lp_mint(ctx: Context<SetLpMint>) -> Result<()> {
        let pool = &mut ctx.accounts.pool_state;
        require!(
            pool.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        require!(pool.paused, TradeFinanceError::PoolMustBePaused);
        require!(
            pool.active_capital == 0 && pool.escrow_funded == 0,
            TradeFinanceError::OutstandingCapital
        );
        require!(
            ctx.accounts.old_lp_mint.supply == 0,
            TradeFinanceError::LpSupplyNotZero
        );
        // 新 mint 的属性校验（审计 C-01/L-05/M-09）：authority 为 pool_authority、无 freeze、decimals 匹配。
        require!(
            ctx.accounts.new_lp_mint.mint_authority
                == COption::Some(ctx.accounts.pool_authority.key()),
            TradeFinanceError::InvalidLpMintAuthority
        );
        require!(
            ctx.accounts.new_lp_mint.freeze_authority.is_none(),
            TradeFinanceError::InvalidLpMintFreezeAuthority
        );
        require!(
            ctx.accounts.new_lp_mint.decimals == LP_MINT_DECIMALS,
            TradeFinanceError::InvalidMintDecimals
        );

        let old_lp_mint = pool.lp_mint;
        pool.lp_mint = ctx.accounts.new_lp_mint.key();
        emit!(LpMintUpdatedEvent {
            admin: pool.admin,
            old_lp_mint,
            new_lp_mint: pool.lp_mint,
        });
        msg!("lp mint updated: {} -> {}", old_lp_mint, pool.lp_mint);
        Ok(())
    }

    /// 关闭已终态订单并退还租金（审计 L-02）。要求托管余额为 0（Accounts 约束）。
    pub fn close_deal(ctx: Context<CloseDeal>, trade_id: u64) -> Result<()> {
        let deal = &ctx.accounts.deal;
        require!(
            matches!(
                deal.status,
                deal_status::SETTLED | deal_status::DEFAULTED
            ),
            TradeFinanceError::InvalidStateTransition
        );
        msg!("deal {} closed, rent returned to buyer", trade_id);
        Ok(())
    }

    /// 更新费率与分配参数（H-04 治理）。应置于多签/时锁（H-03）之后。
    pub fn set_fee_params(
        ctx: Context<SetFeeParams>,
        fee_apy_bps: u64,
        lp_share_bps: u64,
        platform_share_bps: u64,
        rebate_share_bps: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool_state;
        require!(
            pool.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        let total_share = lp_share_bps
            .checked_add(platform_share_bps)
            .ok_or(TradeFinanceError::MathOverflow)?
            .checked_add(rebate_share_bps)
            .ok_or(TradeFinanceError::MathOverflow)?;
        require!(total_share == BPS_BASE, TradeFinanceError::InvalidFeeParams);
        require!(fee_apy_bps > 0 && fee_apy_bps <= 5000, TradeFinanceError::InvalidFeeParams);
        pool.fee_apy_bps = fee_apy_bps;
        pool.lp_share_bps = lp_share_bps;
        pool.platform_share_bps = platform_share_bps;
        pool.rebate_share_bps = rebate_share_bps;
        emit!(FeeParamsUpdatedEvent {
            admin: pool.admin,
            fee_apy_bps,
            lp_share_bps,
            platform_share_bps,
            rebate_share_bps,
        });
        msg!(
            "fee params updated: apy={} lp={} platform={} rebate={}",
            fee_apy_bps,
            lp_share_bps,
            platform_share_bps,
            rebate_share_bps
        );
        Ok(())
    }

    /// 平台注入首损资金（H-04）：真实 USDC 进入金库，计入 first_loss_reserve（不计 LP 净值）。
    pub fn deposit_first_loss(ctx: Context<DepositFirstLoss>, amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool_state;
        require!(
            pool.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        require!(amount > 0, TradeFinanceError::InvalidAmount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.depositor_token_account.to_account_info(),
                    to: ctx.accounts.pool_token_account.to_account_info(),
                    authority: ctx.accounts.admin.to_account_info(),
                },
            ),
            amount,
        )?;
        ctx.accounts.pool_token_account.reload()?;

        pool.first_loss_reserve = pool
            .first_loss_reserve
            .checked_add(amount)
            .ok_or(TradeFinanceError::MathOverflow)?;
        emit!(FirstLossDepositedEvent {
            admin: ctx.accounts.admin.key(),
            amount,
            first_loss_reserve: pool.first_loss_reserve,
        });
        msg!(
            "first-loss reserve: {} USDC deposited, total {}",
            amount,
            pool.first_loss_reserve
        );
        Ok(())
    }

    /// 治理提取首损资金（H-04）：仅允许提取至最低保留余额之上。
    pub fn withdraw_first_loss(ctx: Context<WithdrawFirstLoss>, amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool_state;
        require!(
            pool.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        require!(amount > 0, TradeFinanceError::InvalidAmount);
        let remaining = pool
            .first_loss_reserve
            .checked_sub(amount)
            .ok_or(TradeFinanceError::FirstLossInsufficient)?;
        require!(
            remaining >= MIN_FIRST_LOSS_ABS,
            TradeFinanceError::FirstLossInsufficient
        );
        // 提取后金库现金必须仍覆盖首损剩余 + 在途垫付。
        let vault_after = ctx
            .accounts
            .pool_token_account
            .amount
            .checked_sub(amount)
            .ok_or(TradeFinanceError::InsufficientFunds)?;
        let outstanding = pool
            .active_capital
            .checked_add(pool.escrow_funded)
            .ok_or(TradeFinanceError::MathOverflow)?;
        require!(
            vault_after >= remaining.checked_add(outstanding).ok_or(TradeFinanceError::MathOverflow)?,
            TradeFinanceError::InsufficientFunds
        );

        let pool_bump = [ctx.bumps.pool_authority];
        let pool_signer: &[&[u8]] = &[b"trade_finance", b"pool_usdc", &pool_bump];
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_token_account.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
            )
            .with_signer(&[pool_signer]),
            amount,
        )?;
        ctx.accounts.pool_token_account.reload()?;

        pool.first_loss_reserve = remaining;
        emit!(FirstLossWithdrawnEvent {
            admin: ctx.accounts.admin.key(),
            amount,
            first_loss_reserve: pool.first_loss_reserve,
        });
        msg!(
            "first-loss reserve: {} USDC withdrawn, remaining {}",
            amount,
            pool.first_loss_reserve
        );
        Ok(())
    }

    /// 更新风控参数（审计 L-07/L-04）：保险基金最低余额（支持清盘路径）、逾期罚息年化费率。
    pub fn set_risk_params(
        ctx: Context<SetRiskParams>,
        min_insurance_abs: u64,
        overdue_fee_apy_bps: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool_state;
        require!(
            pool.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        require!(
            overdue_fee_apy_bps <= 5000,
            TradeFinanceError::InvalidFeeParams
        );
        pool.min_insurance_abs = min_insurance_abs;
        pool.overdue_fee_apy_bps = overdue_fee_apy_bps;
        emit!(RiskParamsUpdatedEvent {
            admin: pool.admin,
            min_insurance_abs,
            overdue_fee_apy_bps,
        });
        msg!(
            "risk params updated: min_insurance_abs={}, overdue_fee_apy_bps={}",
            min_insurance_abs,
            overdue_fee_apy_bps
        );
        Ok(())
    }

    /// 调整管理员转移锁定期（审计 N-02）：默认 48h，可经治理下调（测试/紧急）或上调。
    /// 生产环境应保持 >= 172_800 秒。
    pub fn set_admin_delay(ctx: Context<SetAdminDelay>, delay_secs: i64) -> Result<()> {
        let pool = &mut ctx.accounts.pool_state;
        require!(
            pool.admin == ctx.accounts.admin.key(),
            TradeFinanceError::Unauthorized
        );
        // 审计 H-05：不得将时锁下调至硬下限（86_400s）以下，杜绝"置零自废后门"。
        require!(
            delay_secs >= MIN_ADMIN_DELAY_SECS,
            TradeFinanceError::InvalidFeeParams
        );
        pool.pending_admin_delay_secs = delay_secs;
        emit!(RiskParamsUpdatedEvent {
            admin: pool.admin,
            min_insurance_abs: pool.min_insurance_abs,
            overdue_fee_apy_bps: pool.overdue_fee_apy_bps,
        });
        msg!("admin transfer delay set to {}s", delay_secs);
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
    /// 锚定的 USDC / LP Mint（审计 S-01）：初始化时写入。
    pub usdc_mint: Account<'info, Mint>,
    /// LP Mint：authority 必须为 pool_authority、无 freeze authority、decimals 匹配（审计 C-01/L-05/M-09）。
    pub lp_mint: Account<'info, Mint>,
    /// CHECK: 资金池 USDC 托管账户的 PDA authority（同时作为 LP 铸币 authority，审计 C-01）。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,
    /// 程序数据账户（原生格式，手动解析）：upgrade authority 必须为初始化者（审计 H-01/N-05）。
    /// CHECK: 仅用于读取 upgrade authority，不反序列化 anchor 结构。
    pub program_data: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetPoolInfo<'info> {
    #[account(seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct ProposeAdmin<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    /// 待接受的新管理员：必须是提案中的 pending_admin（审计 H-03）。
    pub new_admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetPlatformWallet<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(trade_id: u64, file_hash: [u8; 32], uri: String)]
pub struct AttestDocument<'info> {
    #[account(seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = DocumentRecord::space(),
        seeds = [
            b"trade_finance",
            b"document" as &[u8],
            buyer.key().as_ref(),
            trade_id.to_le_bytes().as_ref(),
            file_hash.as_ref()
        ],
        bump
    )]
    pub document: Account<'info, DocumentRecord>,

    /// CHECK: 买方公钥用于推导单据 PDA（审计 M-06：按买方隔离命名空间）。
    pub buyer: AccountInfo<'info>,

    /// 关联订单：必选，且必须与买方匹配（审计 M-06，杜绝任意地址存证）。
    #[account(
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
        associated_token::mint = usdc_mint,
        associated_token::authority = buyer
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = deal
    )]
    pub deal_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = pool_state.usdc_mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    /// 资金池金库（审计 M-08：集中度上限改为基于可用流动性）。
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool_authority
    )]
    pub pool_token_account: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
#[instruction(trade_id: u64)]
pub struct FundDeal<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

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
    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool_authority
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = deal
    )]
    pub deal_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = pool_state.usdc_mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    #[account(
        constraint = pool_state.lp_mint == lp_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub lp_mint: Account<'info, Mint>,

}
#[derive(Accounts)]
#[instruction(trade_id: u64, target_status: u8)]
pub struct AdvanceDeal<'info> {
    #[account(seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

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
        associated_token::mint = usdc_mint,
        associated_token::authority = deal
    )]
    pub deal_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = deal.seller
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = pool_state.usdc_mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefreshNav<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    pub admin: Signer<'info>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        associated_token::mint = usdc_mint,
        associated_token::authority = pool_authority
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = pool_state.usdc_mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        constraint = pool_state.lp_mint == lp_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
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
        associated_token::mint = usdc_mint,
        associated_token::authority = buyer
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool_state.platform_wallet
    )]
    pub platform_token_account: Account<'info, TokenAccount>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool_authority
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = pool_state.usdc_mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    #[account(
        constraint = pool_state.lp_mint == lp_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = RebateRecord::space(),
        seeds = [b"trade_finance", b"rebate" as &[u8], buyer.key().as_ref()],
        bump
    )]
    pub rebate: Account<'info, RebateRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DistributeDividends<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: 分红接收方钱包，owner 由 recipient_token_account 约束校验。
    pub recipient: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = recipient
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    /// 接收方 LP 持仓（审计 L-11：仅向 LP 持有者分红，且按占比限制单次金额）。
    #[account(
        associated_token::mint = lp_mint,
        associated_token::authority = recipient
    )]
    pub recipient_lp_token_account: Account<'info, TokenAccount>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool_authority
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = pool_state.usdc_mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    #[account(
        constraint = pool_state.lp_mint == lp_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub lp_mint: Account<'info, Mint>,

    /// 分红领取台账（审计 H-02 方案 A）：记录每个接收方累计领取额，使分配可审计。
    #[account(
        init_if_needed,
        payer = admin,
        space = DividendClaim::space(),
        seeds = [b"trade_finance", b"dividend_claim" as &[u8], recipient.key().as_ref()],
        bump
    )]
    pub dividend_claim: Account<'info, DividendClaim>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct DepositPool<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    pub depositor: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = depositor
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool_authority
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = pool_state.usdc_mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    #[account(
        mut,
        constraint = pool_state.lp_mint == lp_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub lp_mint: Account<'info, Mint>,

    /// 出资人 LP 代币账户（审计 C-01：存入 USDC 后在同一指令内按 NAV 铸造 LP）。
    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = depositor
    )]
    pub depositor_lp_token_account: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct RedeemLp<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    pub lp_user: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = lp_user
    )]
    pub lp_user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = lp_user
    )]
    pub lp_user_usdc_token_account: Account<'info, TokenAccount>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool_authority
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = pool_state.usdc_mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub usdc_mint: Account<'info, Mint>,
    #[account(mut)]
    #[account(
        constraint = pool_state.lp_mint == lp_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub lp_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(trade_id: u64)]
pub struct DefaultDeal<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

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
        associated_token::mint = usdc_mint,
        associated_token::authority = pool_authority
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = deal
    )]
    pub deal_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = pool_state.usdc_mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    #[account(
        constraint = pool_state.lp_mint == lp_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub lp_mint: Account<'info, Mint>,

}
#[derive(Accounts)]
pub struct SetLpMint<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    pub admin: Signer<'info>,

    /// 旧 LP Mint：供应量必须为 0（审计 M-09）。
    #[account(
        constraint = pool_state.lp_mint == old_lp_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub old_lp_mint: Account<'info, Mint>,

    /// 新 LP Mint：authority 必须为 pool_authority、无 freeze authority、decimals 匹配（审计 M-09）。
    pub new_lp_mint: Account<'info, Mint>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority（新 LP mint 的 authority）。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(trade_id: u64)]
pub struct CloseDeal<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    /// 买方：推导订单 PDA，并作为租金退还接收方签名关闭（审计 L-02）。
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
        close = buyer,
        constraint = deal.buyer == buyer.key() @ TradeFinanceError::Unauthorized
    )]
    pub deal: Account<'info, TradeDeal>,

    /// 托管账户：必须已清空（余额为 0）方可关闭订单（审计 L-02）。
    #[account(
        associated_token::mint = pool_state.usdc_mint,
        associated_token::authority = deal,
        constraint = deal_token_account.amount == 0 @ TradeFinanceError::InvalidAmount
    )]
    pub deal_token_account: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetFeeParams<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct DepositFirstLoss<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    /// 平台运营钱包（注入首损资金）。
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = admin
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool_authority
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = pool_state.usdc_mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawFirstLoss<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = admin
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    /// CHECK: 资金池 USDC 托管账户的 PDA authority。
    #[account(seeds = [b"trade_finance", b"pool_usdc" as &[u8]], bump)]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool_authority
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = pool_state.usdc_mint == usdc_mint.key() @ TradeFinanceError::WrongTokenMint
    )]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetRiskParams<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetAdminDelay<'info> {
    #[account(mut, seeds = [b"trade_finance", b"pool"], bump)]
    pub pool_state: Account<'info, PoolState>,

    pub admin: Signer<'info>,
}
