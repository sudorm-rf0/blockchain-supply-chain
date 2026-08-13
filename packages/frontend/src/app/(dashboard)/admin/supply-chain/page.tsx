"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Transaction } from "@solana/web3.js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWalletContext } from "@/hooks/useWalletContext";
import {
  authorizeSupplier,
  confirmAuthorizeSupplier,
  confirmInitRegistry,
  confirmRegisterProduct,
  confirmRevokeSupplier,
  fetchProducts,
  fetchRegistry,
  fetchSuppliers,
  initRegistry,
  registerProduct,
  revokeSupplier,
  type ProductRecord,
  type RegistryStatus,
  type SupplierRecord,
} from "@/lib/supply-chain-api";
import { confirmTransactionWithTimeout } from "@/lib/solana";

const shorten = (address: string) =>
  address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;

export default function SupplyChainAdminPage() {
  const { t } = useTranslation();
  const { connected, publicKey, connection, sendTransaction } = useWalletContext();
  const [registry, setRegistry] = useState<RegistryStatus | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [supplierAddress, setSupplierAddress] = useState("");
  const [sku, setSku] = useState("");
  const [units, setUnits] = useState("");

  const load = useCallback(async () => {
    const [reg, sup, prod] = await Promise.all([
      fetchRegistry(),
      fetchSuppliers(),
      fetchProducts(),
    ]);
    setRegistry(reg);
    setSuppliers(sup);
    setProducts(prod);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("supplyChain.loadFailed"));
      } finally {
        setLoading(false);
      }
    })();
  }, [load, t]);

  const requireWallet = (): string | null => {
    if (!connected || !publicKey) {
      toast.error(t("supplyChain.connectWallet"));
      return null;
    }
    return publicKey.toBase58();
  };

  const signAndConfirm = async (
    build: () => Promise<{ transaction: string }>,
    confirm: (signature: string) => Promise<{ ok: boolean }>,
    successMessage: string,
  ) => {
    const wallet = requireWallet();
    if (!wallet) return;
    setBusy(true);
    try {
      const built = await build();
      const transaction = Transaction.from(Buffer.from(built.transaction, "base64"));
      const signature = await sendTransaction(transaction, connection);
      await confirmTransactionWithTimeout(connection, signature, "confirmed");
      const result = await confirm(signature);
      if (!result.ok) throw new Error(t("supplyChain.confirmFailed"));
      toast.success(successMessage);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("supplyChain.onchainFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleInitRegistry = () =>
    signAndConfirm(
      () => initRegistry({ adminWallet: requireWallet()! }),
      (sig) => confirmInitRegistry({ adminWallet: publicKey!.toBase58(), txSignature: sig }),
      t("supplyChain.registryInitialized"),
    );

  const handleAuthorize = () => {
    const wallet = requireWallet();
    if (!wallet) return;
    if (!supplierAddress.trim()) {
      toast.error(t("supplyChain.supplierAddressRequired"));
      return;
    }
    void signAndConfirm(
      () => authorizeSupplier({ adminWallet: wallet, supplier: supplierAddress.trim() }),
      (sig) => confirmAuthorizeSupplier({ supplier: supplierAddress.trim(), txSignature: sig }),
      t("supplyChain.supplierAuthorized"),
    );
  };

  const handleRevoke = (address: string) => {
    const wallet = requireWallet();
    if (!wallet) return;
    void signAndConfirm(
      () => revokeSupplier(address, { adminWallet: wallet }),
      (sig) => confirmRevokeSupplier(address, { txSignature: sig }),
      t("supplyChain.supplierRevoked"),
    );
  };

  const handleRegisterProduct = () => {
    const wallet = requireWallet();
    if (!wallet) return;
    if (!sku.trim() || !/^\d+$/.test(units) || Number(units) <= 0) {
      toast.error(t("supplyChain.productValidation"));
      return;
    }
    void signAndConfirm(
      () => registerProduct({ adminWallet: wallet, sku: sku.trim(), units }),
      (sig) =>
        confirmRegisterProduct({
          adminWallet: publicKey!.toBase58(),
          sku: sku.trim(),
          units,
          txSignature: sig,
        }),
      t("supplyChain.productRegistered"),
    );
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("supplyChain.loading")}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("supplyChain.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("supplyChain.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("supplyChain.registryTitle")}</CardTitle>
          <CardDescription>{t("supplyChain.registryDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {registry?.initialized ? (
            <div className="space-y-1 text-sm">
              <div>
                {t("supplyChain.statusLabel")}
                <Badge className="bg-green-600">{t("supplyChain.initialized")}</Badge>
              </div>
              <div>
                {t("supplyChain.adminLabel")}
                <span className="font-mono">{shorten(registry.admin ?? "")}</span>
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                {registry.registry}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-amber-600">{t("supplyChain.notInitialized")}</p>
              <Button onClick={handleInitRegistry} disabled={busy || !connected}>
                {t("supplyChain.initRegistry")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("supplyChain.suppliersTitle")}</CardTitle>
          <CardDescription>{t("supplyChain.suppliersDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder={t("supplyChain.supplierAddressPlaceholder")}
              value={supplierAddress}
              onChange={(e) => setSupplierAddress(e.target.value)}
              className="font-mono"
            />
            <Button onClick={handleAuthorize} disabled={busy || !connected}>
              {t("supplyChain.authorize")}
            </Button>
          </div>
          {suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("supplyChain.noSuppliers")}</p>
          ) : (
            <ul className="divide-y">
              {suppliers.map((s) => (
                <li key={s.address} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{s.address}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("supplyChain.authorizedAt", {
                        date: new Date(s.authorizedAt).toLocaleString(),
                      })}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRevoke(s.address)}
                    disabled={busy || !connected}
                  >
                    {t("supplyChain.revoke")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("supplyChain.productsTitle")}</CardTitle>
          <CardDescription>{t("supplyChain.productsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
            <Input
              placeholder={t("supplyChain.skuPlaceholder")}
              value={sku}
              onChange={(e) => setSku(e.target.value)}
            />
            <Input
              placeholder={t("supplyChain.unitsPlaceholder")}
              value={units}
              onChange={(e) => setUnits(e.target.value)}
            />
            <Button onClick={handleRegisterProduct} disabled={busy || !connected}>
              {t("supplyChain.register")}
            </Button>
          </div>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("supplyChain.noProducts")}</p>
          ) : (
            <ul className="divide-y">
              {products.map((p) => (
                <li key={p.pda} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {p.sku} <span className="text-muted-foreground">× {p.units}</span>
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      owner: {shorten(p.owner)}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
