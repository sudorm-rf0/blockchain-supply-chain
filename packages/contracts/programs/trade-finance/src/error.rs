use anchor_lang::prelude::*;

#[error_code]
pub enum TradeFinanceError {
    /// 资金不足：买方 token 余额或资金池活跃资金不足以完成当前操作。
    #[msg("Insufficient funds")]
    InsufficientFunds,

    /// 账期不符合：账期只允许 30/60/90/120 天。
    #[msg("Tenor must be one of 30/60/90/120 days")]
    InvalidTenor,

    /// 非授权调用者：只有资金池管理员或订单对应买方可以执行该操作。
    #[msg("Unauthorized caller")]
    Unauthorized,

    /// 贸易 ID 不存在：链上找不到对应的 TradeDeal 账户。
    #[msg("Trade not found")]
    TradeNotFound,

    /// 状态机跳转非法：例如已 Settled 的订单不能再次转为 Funded。
    #[msg("Invalid state transition")]
    InvalidStateTransition,

    /// 单笔贸易集中度超限：池垫付金额超过资金池总资产 1% 上限。
    #[msg("Single trade exceeds the 1% concentration limit")]
    OverConcentration,

    /// 算术溢出：金额计算或账户字段累加时发生溢出。
    #[msg("Math overflow")]
    MathOverflow,

    /// 保险基金余额不足：无法完成违约赔付。
    #[msg("Insurance fund balance is insufficient for the payout")]
    InsufficientInsuranceFund,

    /// 账期未到期：REPAYING 状态的订单在账期截止前不能标记违约。
    #[msg("Deal tenor has not expired yet")]
    DealNotExpired,

    /// 订单金额非法：贸易金额必须大于 0。
    #[msg("Deal amount must be greater than zero")]
    InvalidAmount,

    /// 订单尚未 Pending：只有 Pending 状态的订单可以放款。
    #[msg("Deal must be Pending before funding")]
    DealNotPending,

    /// Token 账户 mint 不匹配：资金操作只接受 USDC。
    #[msg("Token account owner mismatch")]
    WrongTokenAccountOwner,

    /// Token 账户 mint 不匹配：资金操作只接受 USDC。
    #[msg("Token account mint mismatch")]
    WrongTokenMint,

    /// LP 代币总供应量为 0：无法计算 NAV。
    #[msg("LP token supply must be greater than zero")]
    ZeroLpSupply,

    /// 状态码非法：TradeDeal.status 不是已知的枚举值。
    #[msg("Unsupported deal status")]
    InvalidStatus,

    /// 订单尚未完成交付：只有 Delivered 状态可以释放托管资金给卖方。
    #[msg("Deal must be Delivered before release to seller")]
    DealNotDelivered,

    /// 订单尚未进入还款期：只有 Repaying 状态可以完成结清。
    #[msg("Deal must be Repaying before settlement")]
    DealNotRepaying,

    /// 单据 URI 超长：链上存证 URI 不能为空且不能超过 256 字节。
    #[msg("Document URI must not be empty or exceed 256 bytes")]
    InvalidDocumentUri,

    /// 单据与订单不匹配：上传者不是 TradeDeal 的买方或卖方。
    #[msg("Document owner is not a party of the trade")]
    InvalidDocumentOwner,

    /// 赎回数量非法：LP 赎回数量必须大于 0，且换算出的 USDC 必须大于 0。
    #[msg("Redeem amount must be greater than zero")]
    ZeroRedeemAmount,

    /// LP 余额不足：用户 LP 代币余额不足以完成赎回。
    #[msg("Insufficient LP token balance")]
    InsufficientLpTokens,

    /// 单次赎回超限：单次赎回不得超过闲置资金上限（默认 50%）。
    #[msg("Redeem exceeds the single-transaction limit")]
    MaxRedeemExceeded,

    /// 保险基金不足：赎回后保险基金低于最低余额，拒绝操作以保护资金池。
    #[msg("Insurance fund would fall below the minimum balance")]
    InsuranceRatioTooLow,

    /// 待分配 LP 分红不足：无法完成本次分红发放。
    #[msg("Pending LP dividends are insufficient for the distribution")]
    InsufficientDividends,

    /// 资金池已暂停：管理员触发紧急冻结，全部资金移动指令被拒绝。
    #[msg("Pool is paused; money-moving operations are frozen")]
    PoolPaused,

    /// 新管理员地址非法：不能把管理员转移给全零公钥。
    #[msg("New admin must not be the default public key")]
    InvalidNewAdmin,

    /// 平台钱包地址非法：不能把收款钱包设为全零公钥。
    #[msg("Platform wallet must not be the default public key")]
    InvalidPlatformWallet,
    /// 铸币数量非法：按当期 NAV 折算的 LP 份额为 0。
    #[msg("Computed LP share is zero")]
    ZeroShareMint,

    /// LP Mint authority 非法：必须为 pool_authority PDA。
    #[msg("LP mint authority must be the pool authority PDA")]
    InvalidLpMintAuthority,

    /// LP Mint 存在 freeze authority：不允许冻结 LP 账户。
    #[msg("LP mint must not have a freeze authority")]
    InvalidLpMintFreezeAuthority,

    /// LP Mint 精度非法：与协议约定的 decimals 不一致。
    #[msg("LP mint decimals mismatch")]
    InvalidMintDecimals,

    /// 治理时锁：没有待执行的治理动作。
    #[msg("No governance action pending")]
    GovActionNotPending,

    /// 治理时锁：提案尚未过等待期，不能执行。
    #[msg("Governance timelock has not elapsed")]
    GovDelayNotElapsed,

    /// 卖方不能是买方自身：禁止自融资闭环。
    #[msg("Seller must not be the buyer")]
    SelfDealing,

    /// 卖方地址非法：不能是全零公钥。
    #[msg("Seller must not be the default public key")]
    InvalidSeller,

    /// 该操作要求资金池处于暂停状态。
    #[msg("Pool must be paused for this operation")]
    PoolMustBePaused,

    /// 该操作要求资金池无在途敞口。
    #[msg("Active capital must be zero for this operation")]
    OutstandingCapital,

    /// 该操作要求旧 LP Mint 供应量为 0。
    #[msg("LP supply must be zero for this operation")]
    LpSupplyNotZero,

    /// 周期内赎回超限：赎回超出当前时间窗口的累计上限。
    #[msg("Redeem exceeds the periodic window limit")]
    RedeemWindowExceeded,

    /// 金库现金不足以覆盖保险基金：禁止继续放款。
    #[msg("Vault cash would fall below the insurance fund")]
    InsuranceFundNotBacked,

    /// 已存在未完成的管理员转移提案。
    #[msg("An admin transfer is already pending")]
    PendingAdminExists,

    /// 不存在待接受的管理员转移提案。
    #[msg("No pending admin transfer")]
    NoPendingAdmin,

    /// 管理员转移锁定期尚未结束。
    #[msg("Admin transfer lock period has not elapsed")]
    AdminLockNotElapsed,

    /// 账本不变式被破坏（调试断言）。
    #[msg("Invariant violated")]
    InvariantViolated,

    /// 费率参数非法：分配比例之和必须等于 10000，且费率不得超过上限。
    #[msg("Invalid fee parameters")]
    InvalidFeeParams,

    /// 单笔费率超过上限（H-04 D7 保护）。
    #[msg("Fee exceeds the single-transaction cap")]
    MaxFeeExceeded,

    /// 首损资金不足：无法完成提取。
    #[msg("First-loss reserve is insufficient")]
    FirstLossInsufficient,

    /// 审计 H-1 链上强制多签：已配置多签，admin 签名者必须是 Squads vault PDA。
    #[msg("Multisig enforcement active: admin signer must be the Squads vault PDA")]
    MultisigEnforced,

    /// 审计 H-1：多签轮换已存在待接受提案。
    #[msg("A multisig rotation is already pending")]
    PendingMultisigExists,

    /// 审计 H-1：不存在待接受的多签轮换提案。
    #[msg("No pending multisig rotation")]
    NoPendingMultisig,

    /// 审计 H-1：多签轮换锁定期尚未结束。
    #[msg("Multisig rotation lock period has not elapsed")]
    MultisigLockNotElapsed,
}
