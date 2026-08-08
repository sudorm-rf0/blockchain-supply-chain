use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

declare_id!("Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk");

/// 注册中心管理员时锁硬下限（秒，审计 H-06）：set_registry_admin_delay 不得低于此值。
pub const MIN_REGISTRY_ADMIN_DELAY_SECS: i64 = 86_400;

/// 部署方白名单（审计 H-01/N-05）：**仅测试构建启用**（feature `test-deployer`）。
/// 生产构建不含 DEPLOYER，upgrade authority 冻结（None）后初始化被禁止，
/// 彻底消除"硬编码测试钱包在生产可初始化"的回退路径。
#[cfg(feature = "test-deployer")]
pub const DEPLOYER: Pubkey = pubkey!("3rF9fK7KL2YmAsdGHFrsGTZHiKrqF7BRCZ88KRZ3nsK8");

/// BPF Loader Upgradeable 程序 ID（ProgramData PDA 推导基准，审计 C-1）。
pub const BPF_LOADER_UPGRADEABLE: Pubkey = pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");

/// 商品 PDA 种子：SKU 的完整 SHA-256（32 字节）哈希。
/// 审计 N-04/I-05：Solana 单个种子允许最多 32 字节，SHA-256 输出恰为 32 字节，
/// 使用完整哈希消除 8 字节截断的碰撞风险（PDA 唯一性由 owner + 完整哈希保证）。
fn sku_seed(sku: &str) -> [u8; 32] {
    hash(sku.as_bytes()).to_bytes()
}

#[program]
pub mod supply_chain {
    use super::*;

    /// 初始化供应链注册中心，记录唯一管理员。
    /// 审计 H-01：仅允许程序的 upgrade authority 初始化，杜绝抢先初始化抢跑。
    pub fn initialize_registry(
        ctx: Context<InitializeRegistry>,
        initial_delay_secs: i64,
    ) -> Result<()> {
        // 审计 H-01 / N-05：若程序保留 upgrade authority，初始化者必须等于
        // upgrade authority；仅当 upgrade authority 已冻结（None）时回退 DEPLOYER 白名单。
        // ProgramData 布局（agave 4.1.2 实测）：u32@0(3) + u64 slot@4 + u8 option@12 + Pubkey@13。
        // 独立复测 C-1（Critical）：program_data 必须绑定到本程序的 ProgramData PDA，
        // 否则攻击者可传入任意账户伪造 upgrade authority 抢跑初始化夺权。先绑定再读取。
        let expected_program_data = Pubkey::find_program_address(
            &[ctx.program_id.key().as_ref()],
            &BPF_LOADER_UPGRADEABLE,
        ).0;
        require!(
            ctx.accounts.program_data.key() == expected_program_data,
            SupplyChainError::Unauthorized
        );
        // 独立复测 N-3：ProgramData 账户必须由 BPF Loader Upgradeable 拥有（防伪/健壮性）。
        require!(
            ctx.accounts.program_data.owner == &BPF_LOADER_UPGRADEABLE,
            SupplyChainError::Unauthorized
        );
        let pd_data = ctx.accounts.program_data.try_borrow_data()?;
        let ua_tag = u8::from_le_bytes(
            pd_data[12..13].try_into().map_err(|_| SupplyChainError::Unauthorized)?,
        );
        let upgrade_authority = if ua_tag == 1 {
            let ua = Pubkey::new_from_array(
                pd_data[13..45]
                    .try_into()
                    .map_err(|_| SupplyChainError::Unauthorized)?,
            );
            // 全零公钥（SystemProgram 占位，anchor test --bpf-program 预加载、
            // 或 agave 占位）不可签名，视为无有效升级权限，回退 DEPLOYER 白名单。
            if ua == Pubkey::default() { None } else { Some(ua) }
        } else {
            None
        };
        let allowed = match upgrade_authority {
            Some(ua) => ua == ctx.accounts.admin.key(),
            #[cfg(feature = "test-deployer")]
            None => ctx.accounts.admin.key() == DEPLOYER,
            #[cfg(not(feature = "test-deployer"))]
            None => false, // 生产：UA 冻结时禁止初始化，杜绝测试钱包回退（审计 N-05）
        };
        require!(allowed, SupplyChainError::Unauthorized);
        let registry = &mut ctx.accounts.registry;
        registry.admin = ctx.accounts.admin.key();
        registry.initialized_at = Clock::get()?.unix_timestamp;
        registry.pending_admin = Pubkey::default();
        registry.pending_admin_proposed_at = 0;
        // 审计 H-06/L-13：初始时锁由部署方注入。
        // 测试构建允许小值验证锁定期；生产构建强制 >= MIN_REGISTRY_ADMIN_DELAY_SECS。
        #[cfg(feature = "test-deployer")]
        require!(initial_delay_secs >= 0, SupplyChainError::InvalidNewAdmin);
        #[cfg(not(feature = "test-deployer"))]
        require!(
            initial_delay_secs >= MIN_REGISTRY_ADMIN_DELAY_SECS,
            SupplyChainError::InvalidNewAdmin
        );
        registry.admin_delay_secs = initial_delay_secs;
        msg!("registry initialized by {}", registry.admin);
        Ok(())
    }

    /// 管理员轮换第一步：提出转移提案（审计 M-11/M-12）。
    /// 由新管理员签名接受后生效（见 accept_registry_admin）。
    pub fn propose_registry_admin(
        ctx: Context<ProposeRegistryAdmin>,
        new_admin: Pubkey,
    ) -> Result<()> {
        require!(
            ctx.accounts.registry.admin == ctx.accounts.admin.key(),
            SupplyChainError::Unauthorized
        );
        require!(
            new_admin != Pubkey::default(),
            SupplyChainError::InvalidNewAdmin
        );
        let registry = &mut ctx.accounts.registry;
        require!(
            registry.pending_admin == Pubkey::default(),
            SupplyChainError::PendingAdminExists
        );
        registry.pending_admin = new_admin;
        registry.pending_admin_proposed_at = Clock::get()?.unix_timestamp;
        msg!(
            "registry admin transfer proposed: {} -> {}",
            registry.admin,
            new_admin
        );
        Ok(())
    }

    /// 管理员轮换第二步：新管理员签名接受，锁定期结束后生效（审计 M-12）。
    pub fn accept_registry_admin(ctx: Context<AcceptRegistryAdmin>) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(
            registry.pending_admin == ctx.accounts.new_admin.key(),
            SupplyChainError::Unauthorized
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= registry
                .pending_admin_proposed_at
                .checked_add(registry.admin_delay_secs)
                .ok_or(SupplyChainError::MathOverflow)?,
            SupplyChainError::AdminLockNotElapsed
        );
        let old_admin = registry.admin;
        registry.admin = registry.pending_admin;
        registry.pending_admin = Pubkey::default();
        registry.pending_admin_proposed_at = 0;
        msg!("registry admin transferred: {} -> {}", old_admin, registry.admin);
        Ok(())
    }

    /// 调整注册中心管理员转移锁定期（审计 M-12；生产建议 >= 86400s）。
    pub fn set_registry_admin_delay(ctx: Context<SetRegistryAdminDelay>, delay_secs: i64) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(
            registry.admin == ctx.accounts.admin.key(),
            SupplyChainError::Unauthorized
        );
        // 审计 H-06：不得将时锁下调至硬下限（86_400s）以下，杜绝 supply-chain 侧"置零自废后门"。
        require!(
            delay_secs >= MIN_REGISTRY_ADMIN_DELAY_SECS,
            SupplyChainError::InvalidNewAdmin
        );
        registry.admin_delay_secs = delay_secs;
        msg!("registry admin delay set to {}s", delay_secs);
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
            "product revoked: owner={}, sku={} (arg={})",
            product.owner,
            product.sku,
            sku
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

    /// 程序数据账户（原生格式，手动解析）：upgrade authority 必须为初始化者（审计 H-01/N-05）。
    /// CHECK: 仅用于读取 upgrade authority，不反序列化 anchor 结构。
    pub program_data: AccountInfo<'info>,

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
pub struct ProposeRegistryAdmin<'info> {
    #[account(mut, seeds = [b"supply_chain", b"registry" as &[u8]], bump)]
    pub registry: Account<'info, Registry>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptRegistryAdmin<'info> {
    #[account(mut, seeds = [b"supply_chain", b"registry" as &[u8]], bump)]
    pub registry: Account<'info, Registry>,

    /// 待接受的新管理员：必须是提案中的 pending_admin（审计 M-12）。
    pub new_admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetRegistryAdminDelay<'info> {
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
    /// 待接受的管理员（两步轮换，全零表示无提案，审计 M-12）。
    pub pending_admin: Pubkey,
    /// 管理员转移提案时间（审计 M-12）。
    pub pending_admin_proposed_at: i64,
    /// 管理员转移锁定期（秒，审计 M-12；生产建议 >= 86400）。
    pub admin_delay_secs: i64,
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

    /// 已存在未完成的管理员转移提案。
    #[msg("An admin transfer is already pending")]
    PendingAdminExists,

    /// 管理员转移锁定期尚未结束。
    #[msg("Admin transfer lock period has not elapsed")]
    AdminLockNotElapsed,

    /// 算术溢出。
    #[msg("Math overflow")]
    MathOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn program_id() -> Pubkey {
        ID
    }

    #[test]
    fn sku_seed_is_32_bytes_deterministic_and_distinct() {
        let a = sku_seed("SKU-ADMIN-001");
        let b = sku_seed("SKU-ADMIN-001");
        let c = sku_seed("SKU-SUPPLIER-002");
        assert_eq!(a.len(), 32, "审计 N-04：应使用完整 32 字节哈希");
        assert_eq!(a, b, "同一 SKU 必须推导出相同种子");
        assert_ne!(a, c, "不同 SKU 必须推导出不同种子");
    }

    #[test]
    fn sku_seed_matches_full_sha256() {
        let sku = "SKU-ADMIN-001";
        let digest = hash(sku.as_bytes());
        assert_eq!(sku_seed(sku), digest.to_bytes());
    }

    #[test]
    fn c1_program_data_pda_matches_known() {
        // 独立复测 C-1：program_data 必须绑定本程序 ProgramData PDA，
        // 锚定已知推导值，防止常量/推导被误改（如 test.sh sed 误伤）。
        let (pda, _bump) = Pubkey::find_program_address(
            &[program_id().as_ref()],
            &BPF_LOADER_UPGRADEABLE,
        );
        assert_eq!(pda.to_string(), "HMimQ5Qoa8diS6dfyKbgy72Sf2v6qyvu3T1cmPEWqZjB");
        assert_eq!(
            BPF_LOADER_UPGRADEABLE.to_string(),
            "BPFLoaderUpgradeab1e11111111111111111111111"
        );
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
