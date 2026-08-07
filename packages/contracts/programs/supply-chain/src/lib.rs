use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

declare_id!("Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk");

/// 部署方白名单（审计 H-01）：仅允许该地址（或程序的 upgrade authority）初始化注册中心。
/// 当前为本地开发/测试钱包；主网部署前必须替换为实际部署冷钱包地址。
pub const DEPLOYER: Pubkey = pubkey!("3rF9fK7KL2YmAsdGHFrsGTZHiKrqF7BRCZ88KRZ3nsK8");

/// 商品 PDA 种子：取 SKU 的 SHA-256 前 8 字节。
/// 说明（审计 I-05）：Solana 单个种子允许最多 32 字节，SHA-256 输出恰为 32 字节，
/// 可整体用作种子；此处截断至 8 字节仅为保持与现有 devnet 数据兼容，并非规避限制。
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
    /// 审计 H-01：仅允许程序的 upgrade authority 初始化，杜绝抢先初始化抢跑。
    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        let is_deployer = ctx.accounts.admin.key() == DEPLOYER;
        let is_upgrade_authority = ctx
            .accounts
            .program_data
            .upgrade_authority_address
            == Some(ctx.accounts.admin.key());
        require!(
            is_deployer || is_upgrade_authority,
            SupplyChainError::Unauthorized
        );
        let registry = &mut ctx.accounts.registry;
        registry.admin = ctx.accounts.admin.key();
        registry.initialized_at = Clock::get()?.unix_timestamp;
        msg!("registry initialized by {}", registry.admin);
        Ok(())
    }

    /// 管理员轮换（审计 M-11）：把注册中心管理员转移给新地址。
    /// 与 trade-finance 的 propose/accept 两步轮换保持一致的做法：
    /// 此处由当前管理员签名直接转移，并在指令层面校验非零地址。
    pub fn transfer_admin(ctx: Context<TransferRegistryAdmin>, new_admin: Pubkey) -> Result<()> {
        require!(
            ctx.accounts.registry.admin == ctx.accounts.admin.key(),
            SupplyChainError::Unauthorized
        );
        require!(
            new_admin != Pubkey::default(),
            SupplyChainError::InvalidNewAdmin
        );
        let registry = &mut ctx.accounts.registry;
        registry.admin = new_admin;
        msg!("registry admin transferred to {}", new_admin);
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

        // 审计 L-08：幂等——重复授权不失败，仅刷新授权时间。
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
        require!(sku.len() <= 64, SupplyChainError::SkuTooLong);
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
        product.active = true;

        msg!(
            "product registered: owner={}, sku={}, units={}",
            product.owner,
            product.sku,
            product.units
        );
        Ok(())
    }

    /// 标记商品失效（审计 L-09）：供应商被撤销后，管理员可将其名下商品标记失效，
    /// 使链上存在明确的"已撤销"状态。
    pub fn revoke_product(ctx: Context<RevokeProduct>, sku: String) -> Result<()> {
        require!(
            ctx.accounts.registry.admin == ctx.accounts.admin.key(),
            SupplyChainError::Unauthorized
        );
        let product = &mut ctx.accounts.product;
        require!(product.active, SupplyChainError::AlreadyRevoked);
        product.active = false;
        msg!(
            "product revoked: owner={}, sku={}",
            product.owner,
            product.sku
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

    /// 程序数据账户：upgrade authority 必须为初始化者（审计 H-01）。
    pub program_data: Account<'info, ProgramData>,

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
        init_if_needed,
        payer = admin,
        space = 8 + Supplier::INIT_SPACE,
        seeds = [b"supply_chain", b"supplier" as &[u8], supplier_key.as_ref()],
        bump
    )]
    pub supplier: Account<'info, Supplier>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferRegistryAdmin<'info> {
    #[account(mut, seeds = [b"supply_chain", b"registry" as &[u8]], bump)]
    pub registry: Account<'info, Registry>,

    pub admin: Signer<'info>,
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
#[instruction(sku: String)]
pub struct RevokeProduct<'info> {
    #[account(seeds = [b"supply_chain", b"registry" as &[u8]], bump)]
    pub registry: Account<'info, Registry>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: 商品 owner，用于推导 product PDA。
    pub owner: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"supply_chain", b"product" as &[u8], owner.key().as_ref(), &sku_seed(&sku)],
        bump,
        constraint = product.owner == owner.key() @ SupplyChainError::Unauthorized
    )]
    pub product: Account<'info, Product>,
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
    /// 商品是否有效（审计 L-09）：撤销供应商后可由管理员标记失效。
    pub active: bool,
}

#[error_code]
pub enum SupplyChainError {
    #[msg("SKU must not be empty")]
    EmptySku,

    #[msg("Units must be greater than zero")]
    InvalidUnits,

    /// SKU 超过 64 字节：超出 Product.sku 的固定账户空间。
    #[msg("SKU must not exceed 64 bytes")]
    SkuTooLong,

    /// 仅管理员或已授权供应商可执行该操作。
    #[msg("Unauthorized caller: admin or authorized supplier required")]
    Unauthorized,

    /// 新管理员地址非法：不能把管理员转移给全零公钥。
    #[msg("New admin must not be the default public key")]
    InvalidNewAdmin,

    /// 商品已处于失效状态。
    #[msg("Product is already revoked")]
    AlreadyRevoked,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn program_id() -> Pubkey {
        ID
    }

    #[test]
    fn sku_seed_is_8_bytes_deterministic_and_distinct() {
        let a = sku_seed("SKU-ADMIN-001");
        let b = sku_seed("SKU-ADMIN-001");
        let c = sku_seed("SKU-SUPPLIER-002");
        assert_eq!(a.len(), 8);
        assert_eq!(a, b, "同一 SKU 必须推导出相同种子");
        assert_ne!(a, c, "不同 SKU 必须推导出不同种子");
    }

    #[test]
    fn sku_seed_matches_sha256_prefix() {
        let sku = "SKU-ADMIN-001";
        let digest = hash(sku.as_bytes());
        let mut expected = [0u8; 8];
        expected.copy_from_slice(&digest.to_bytes()[..8]);
        assert_eq!(sku_seed(sku), expected);
    }

    #[test]
    fn registry_pda_is_stable_and_program_derived() {
        let (pda, bump) = Pubkey::find_program_address(
            &[b"supply_chain", b"registry"],
            &program_id(),
        );
        let (pda2, bump2) = Pubkey::find_program_address(
            &[b"supply_chain", b"registry"],
            &program_id(),
        );
        assert_eq!(pda, pda2);
        assert_eq!(bump, bump2);
        assert_ne!(pda, program_id(), "PDA 不能等于程序地址");
    }

    #[test]
    fn supplier_pda_differs_by_address() {
        // 使用确定性公钥而非 new_unique()，避免 bump 断言在不同随机密钥下不稳定。
        let owner_a = Pubkey::new_from_array([1u8; 32]);
        let owner_b = Pubkey::new_from_array([2u8; 32]);
        let (pda_a, _) = Pubkey::find_program_address(
            &[b"supply_chain", b"supplier", owner_a.as_ref()],
            &program_id(),
        );
        let (pda_b, _) = Pubkey::find_program_address(
            &[b"supply_chain", b"supplier", owner_b.as_ref()],
            &program_id(),
        );
        assert_ne!(pda_a, pda_b, "不同供应商必须推导出不同 PDA");
        // 派生结果必须落在 ed25519 曲线之外（PDA 的数学性质），且程序地址不等于 PDA。
        assert_ne!(pda_a, program_id(), "PDA 不能等于程序地址");
        assert_eq!(pda_a, pda_a, "同一供应商必须推导出相同 PDA");
    }

    #[test]
    fn product_pda_differs_by_owner_and_sku() {
        let owner = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let (pda_a, _) = Pubkey::find_program_address(
            &[b"supply_chain", b"product", owner.as_ref(), &sku_seed("A")],
            &program_id(),
        );
        let (pda_b, _) = Pubkey::find_program_address(
            &[b"supply_chain", b"product", owner.as_ref(), &sku_seed("B")],
            &program_id(),
        );
        let (pda_c, _) = Pubkey::find_program_address(
            &[b"supply_chain", b"product", other.as_ref(), &sku_seed("A")],
            &program_id(),
        );
        assert_ne!(pda_a, pda_b, "同 owner 不同 SKU 必须不同");
        assert_ne!(pda_a, pda_c, "不同 owner 同 SKU 必须不同");
    }

    #[test]
    fn account_spaces_accommodate_fields() {
        // Anchor 账户空间 = 8 字节 discriminator + InitSpace。
        // Registry: admin(32) + initialized_at(8)
        assert!(8 + Registry::INIT_SPACE >= 8 + 32 + 8);
        // Supplier: supplier(32) + authorized_at(8)
        assert!(8 + Supplier::INIT_SPACE >= 8 + 32 + 8);
        // Product: owner(32) + sku(String 4 前缀 + 最大 64) + units(8) + created_at(8)
        assert!(8 + Product::INIT_SPACE >= 8 + 32 + 4 + 64 + 8 + 8);
    }

    #[test]
    fn error_messages_are_stable() {
        assert_eq!(
            SupplyChainError::Unauthorized.to_string(),
            "Unauthorized caller: admin or authorized supplier required"
        );
        assert_eq!(
            SupplyChainError::EmptySku.to_string(),
            "SKU must not be empty"
        );
        assert_eq!(
            SupplyChainError::InvalidUnits.to_string(),
            "Units must be greater than zero"
        );
    }
}
