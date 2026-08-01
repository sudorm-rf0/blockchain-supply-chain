use anchor_lang::prelude::*;

declare_id!("Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk");

#[program]
pub mod supply_chain {
    use super::*;

    pub fn register_product(
        ctx: Context<RegisterProduct>,
        sku: String,
        units: u64,
    ) -> Result<()> {
        require!(!sku.is_empty(), SupplyChainError::EmptySku);
        require!(units > 0, SupplyChainError::InvalidUnits);

        let product = &mut ctx.accounts.product;
        product.owner = ctx.accounts.owner.key();
        product.sku = sku;
        product.units = units;
        product.created_at = Clock::get()?.unix_timestamp;

        msg!(
            "product registered: owner={}, units={}",
            product.owner,
            product.units
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RegisterProduct<'info> {
    #[account(init, payer = owner, space = 8 + Product::INIT_SPACE)]
    pub product: Account<'info, Product>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Product {
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
}
