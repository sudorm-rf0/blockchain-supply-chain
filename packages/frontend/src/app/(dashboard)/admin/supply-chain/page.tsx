"use client";

import { useCallback, useEffect, useState } from "react";
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
        toast.error(error instanceof Error ? error.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const requireWallet = (): string | null => {
    if (!connected || !publicKey) {
      toast.error("请先连接钱包");
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
      if (!result.ok) throw new Error("链上确认未通过");
      toast.success(successMessage);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "链上操作失败");
    } finally {
      setBusy(false);
    }
  };

  const handleInitRegistry = () =>
    signAndConfirm(
      () => initRegistry({ adminWallet: requireWallet()! }),
      (sig) => confirmInitRegistry({ adminWallet: publicKey!.toBase58(), txSignature: sig }),
      "注册中心已初始化",
    );

  const handleAuthorize = () => {
    const wallet = requireWallet();
    if (!wallet) return;
    if (!supplierAddress.trim()) {
      toast.error("请输入供应商钱包地址");
      return;
    }
    void signAndConfirm(
      () => authorizeSupplier({ adminWallet: wallet, supplier: supplierAddress.trim() }),
      (sig) => confirmAuthorizeSupplier({ supplier: supplierAddress.trim(), txSignature: sig }),
      "供应商已授权",
    );
  };

  const handleRevoke = (address: string) => {
    const wallet = requireWallet();
    if (!wallet) return;
    void signAndConfirm(
      () => revokeSupplier(address, { adminWallet: wallet }),
      (sig) => confirmRevokeSupplier(address, { txSignature: sig }),
      "供应商已撤销",
    );
  };

  const handleRegisterProduct = () => {
    const wallet = requireWallet();
    if (!wallet) return;
    if (!sku.trim() || !/^\d+$/.test(units) || Number(units) <= 0) {
      toast.error("请填写有效的 SKU 与数量");
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
      "商品已注册上链",
    );
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载中...</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">供应链管理</h1>
        <p className="text-sm text-muted-foreground">
          初始化注册中心、授权/撤销供应商、注册商品（上链操作需管理员钱包签名）
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>注册中心</CardTitle>
          <CardDescription>唯一管理员可注册商品并授权供应商</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {registry?.initialized ? (
            <div className="space-y-1 text-sm">
              <div>
                状态：<Badge className="bg-green-600">已初始化</Badge>
              </div>
              <div>
                管理员：<span className="font-mono">{shorten(registry.admin ?? "")}</span>
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                {registry.registry}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-amber-600">
                注册中心尚未初始化，任何账户（含管理员）都无法注册商品。
              </p>
              <Button onClick={handleInitRegistry} disabled={busy || !connected}>
                初始化注册中心（钱包签名）
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>供应商</CardTitle>
          <CardDescription>授权后可自行注册商品，撤销即失效</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="供应商 Solana 钱包地址"
              value={supplierAddress}
              onChange={(e) => setSupplierAddress(e.target.value)}
              className="font-mono"
            />
            <Button onClick={handleAuthorize} disabled={busy || !connected}>
              授权
            </Button>
          </div>
          {suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无已授权供应商</p>
          ) : (
            <ul className="divide-y">
              {suppliers.map((s) => (
                <li key={s.address} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{s.address}</p>
                    <p className="text-xs text-muted-foreground">
                      授权于 {new Date(s.authorizedAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRevoke(s.address)}
                    disabled={busy || !connected}
                  >
                    撤销
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>商品</CardTitle>
          <CardDescription>管理员注册商品（SKU 唯一）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
            <Input placeholder="SKU（≤64 字符）" value={sku} onChange={(e) => setSku(e.target.value)} />
            <Input placeholder="数量" value={units} onChange={(e) => setUnits(e.target.value)} />
            <Button onClick={handleRegisterProduct} disabled={busy || !connected}>
              注册上链
            </Button>
          </div>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无商品</p>
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
