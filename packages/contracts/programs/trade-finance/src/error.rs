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

    /// 订单尚未 Funded：只有 Funded 状态的订单可以还款或违约处理。
    #[msg("Deal must be Funded before repayment")]
    DealNotFunded,

    /// Token 账户所有者不匹配：转入/转出账户必须归属对应角色。
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

    /// 订单尚未进入运输阶段：只有 Funded 状态可以推进到 InTransit。
    #[msg("Deal must be Funded before entering transit")]
    DealNotFundedForTransit,

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
}
