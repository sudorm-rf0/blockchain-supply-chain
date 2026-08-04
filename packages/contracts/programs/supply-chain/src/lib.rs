use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

declare_id!("Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk");

/// 商品 PDA 种子：取 SKU 的 SHA-256 前 8 字节，规避 Solana 单种子 32 字节限制，
/// 同时保证同一 (owner, sku) 推导出确定的 PDA。
fn sku_seed(sku: &str) -> [u8; 8] {
    let digest = hash(sku.as_bytes());
    let mut seed = [0u8; 8];
    seed.copy_from_slice(&digest.to_bytes()[..8]);
    seed
}

#[program]
pub mod supply_chain {
    use super::*;

    /// 初始化供应链注册中心，记录唯一管理员。
    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.admin = ctx.accounts.admin.key();
        registry.initialized_at = Clock::get()?.unix_timestamp;
        msg!("registry initialized by {}", registry.admin);
        Ok(())
    }

    /// 管理员授权供应商：授权后该供应商可以注册商品。
    pub fn authorize_supplier(
        ctx: Context<AuthorizeSupplier>,
        supplier_key: Pubkey,
    ) -> Result<()> {
        require!(
            ctx.accounts.registry.admin == ctx.accounts.admin.key(),
            SupplyChainError::Unauthorized
        );

        let supplier = &mut ctx.accounts.supplier;
        supplier.supplier = supplier_key;
        supplier.authorized_at = Clock::get()?.unix_timestamp;
        msg!("supplier authorized: {}", supplier.supplier);
        Ok(())
    }

    /// 管理员撤销供应商：关闭授权账户并退还租金，撤销后不可再注册商品。
    pub fn revoke_supplier(
        ctx: Context<RevokeSupplier>,
        supplier_key: Pubkey,
    ) -> Result<()> {
        require!(
            ctx.accounts.registry.admin == ctx.accounts.admin.key(),
            SupplyChainError::Unauthorized
        );
        msg!("supplier revoked: {}", supplier_key);
        Ok(())
    }

    /// 注册商品：仅管理员或已授权供应商可调用；SKU 非空、数量大于 0。
    pub fn register_product(
        ctx: Context<RegisterProduct>,
        sku: String,
        units: u64,
    ) -> Result<()> {
        require!(!sku.is_empty(), SupplyChainError::EmptySku);
        require!(units > 0, SupplyChainError::InvalidUnits);

        let caller = ctx.accounts.owner.key();
        let is_admin = ctx.accounts.registry.admin == caller;
        // 供应商授权记录由 caller 公钥推导：即便传入他人的授权账户，
        // supplier.supplier == caller 也会拒绝，因此必须本人才可注册。
        let is_authorized_supplier = match &ctx.accounts.supplier {
            Some(supplier) => supplier.supplier == caller,
            None => false,
        };
        require!(
            is_admin || is_authorized_supplier,
            SupplyChainError::Unauthorized
        );

        let product = &mut ctx.accounts.product;
        product.owner = caller;
        product.sku = sku;
        product.units = units;
        product.created_at = Clock::get()?.unix_timestamp;

        msg!(
            "product registered: owner={}, sku={}, units={}",
            product.owner,
            product.sku,
            product.units
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Registry::INIT_SPACE,
        seeds = [b"supply_chain", b"registry" as &[u8]],
        bump
    )]
    pub registry: Account<'info, Registry>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(supplier_key: Pubkey)]
pub struct AuthorizeSupplier<'info> {
    #[account(seeds = [b"supply_chain", b"registry" as &[u8]], bump)]
    pub registry: Account<'info, Registry>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Supplier::INIT_SPACE,
        seeds = [b"supply_chain", b"supplier" as &[u8], supplier_key.as_ref()],
        bump
    )]
    pub supplier: Account<'info, Supplier>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(supplier_key: Pubkey)]
pub struct RevokeSupplier<'info> {
    #[account(seeds = [b"supply_chain", b"registry" as &[u8]], bump)]
    pub registry: Account<'info, Registry>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"supply_chain", b"supplier" as &[u8], supplier_key.as_ref()],
        bump,
        close = admin
    )]
    pub supplier: Account<'info, Supplier>,
}

#[derive(Accounts)]
#[instruction(sku: String, units: u64)]
pub struct RegisterProduct<'info> {
    #[account(seeds = [b"supply_chain", b"registry" as &[u8]], bump)]
    pub registry: Account<'info, Registry>,

    #[account(
        init,
        payer = owner,
        space = 8 + Product::INIT_SPACE,
        seeds = [
            b"supply_chain",
            b"product" as &[u8],
            owner.key().as_ref(),
            &sku_seed(&sku),
        ],
        bump
    )]
    pub product: Account<'info, Product>,

    #[account(mut)]
    pub owner: Signer<'info>,

    /// 供应商授权记录（可选）：管理员注册时留空，供应商注册时传入其授权 PDA。
    /// 账户存在性 + supplier 字段与签名者比对，共同保证只有已授权供应商可注册。
    pub supplier: Option<Account<'info, Supplier>>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Registry {
    /// 供应链管理员（唯一，可注册商品并授权/撤销供应商）。
    pub admin: Pubkey,
    /// 注册中心初始化时间。
    pub initialized_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Supplier {
    /// 被授权供应商的钱包地址。
    pub supplier: Pubkey,
    /// 授权时间。
    pub authorized_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Product {
    /// 注册方（管理员或供应商钱包）。
    pub owner: Pubkey,
    #[max_len(64)]
    pub sku: String,
    pub units: u64,
    pub created_at: i64,
}

#[error_code]
pub enum SupplyChainError {
    #[msg("SKU must not be empty")]
    EmptySku,

    #[msg("Units must be greater than zero")]
    InvalidUnits,

    /// 仅管理员或已授权供应商可执行该操作。
    #[msg("Unauthorized caller: admin or authorized supplier required")]
    Unauthorized,
}
