export interface AdminWalletDto {
  adminWallet: string;
}

export interface InitRegistryConfirmDto extends AdminWalletDto {
  txSignature: string;
}

export interface SupplierDto extends AdminWalletDto {
  supplier: string;
}

export interface SupplierConfirmDto extends SupplierDto {
  txSignature: string;
}

export interface RevokeConfirmDto extends AdminWalletDto {
  txSignature: string;
}

export interface RegisterProductDto extends AdminWalletDto {
  sku: string;
  units: string;
  /** 审计 D-01：供应商钱包公钥（供应商注册时必填，管理员注册可省略）。 */
  supplierKey?: string;
}

export interface RegisterProductConfirmDto extends RegisterProductDto {
  txSignature: string;
}
