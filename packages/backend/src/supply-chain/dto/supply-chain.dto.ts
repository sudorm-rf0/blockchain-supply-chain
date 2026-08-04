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
}

export interface RegisterProductConfirmDto extends RegisterProductDto {
  txSignature: string;
}
