"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MailCheck, ShieldCheck, ShieldOff, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  bindWallet,
  disableTotp,
  enableTotp,
  sendEmailOtpCode,
  setupTotp,
} from "@/lib/api";
import { useUserStore } from "@/stores/user-store";

export default function SecurityPage() {
  const user = useUserStore((state) => state.user);
  const setAuth = useUserStore((state) => state.setAuth);
  const [pending, setPending] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const totpEnabled = user?.totpEnabled ?? false;

  // 钱包绑定状态
  const [wallet, setWallet] = useState(user?.wallet ?? "");
  const [walletCode, setWalletCode] = useState("");
  const [walletCooldown, setWalletCooldown] = useState(0);
  const [walletBusy, setWalletBusy] = useState(false);

  useEffect(() => {
    if (walletCooldown <= 0) return;
    const timer = setInterval(() => setWalletCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [walletCooldown]);

  const handleSetup = async () => {
    try {
      setBusy(true);
      const res = await setupTotp();
      setPending(res);
      toast.success("已生成密钥，请在验证器 App 中添加");
    } catch {
      toast.error("生成密钥失败");
    } finally {
      setBusy(false);
    }
  };

  const handleEnable = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast.error("请输入 6 位验证码");
      return;
    }
    try {
      setBusy(true);
      await enableTotp(code);
      if (user) setAuth({ ...user, totpEnabled: true });
      setPending(null);
      setCode("");
      toast.success("两步验证已开启");
    } catch {
      toast.error("验证码错误，请重试");
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast.error("请输入当前 6 位验证码");
      return;
    }
    try {
      setBusy(true);
      await disableTotp(code);
      if (user) setAuth({ ...user, totpEnabled: false });
      setCode("");
      toast.success("两步验证已关闭");
    } catch {
      toast.error("验证码错误，请重试");
    } finally {
      setBusy(false);
    }
  };

  const handleSendWalletCode = async () => {
    setWalletBusy(true);
    try {
      const result = await sendEmailOtpCode();
      setWalletCooldown(result.cooldownSeconds ?? 60);
      toast.success("验证码已发送到邮箱，请查收");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "验证码发送失败");
    } finally {
      setWalletBusy(false);
    }
  };

  const handleBindWallet = async () => {
    const value = wallet.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
      toast.error("钱包地址格式不正确");
      return;
    }
    if (!/^\d{6}$/.test(walletCode)) {
      toast.error("请输入 6 位邮箱验证码");
      return;
    }
    setWalletBusy(true);
    try {
      const updated = await bindWallet(value, walletCode);
      setAuth(updated);
      setWalletCode("");
      toast.success("钱包已绑定");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "绑定失败，请重试");
    } finally {
      setWalletBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">安全设置</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {totpEnabled ? (
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
            ) : (
              <ShieldOff className="h-5 w-5 text-muted-foreground" />
            )}
            两步验证（TOTP）
          </CardTitle>
          <CardDescription>
            {totpEnabled
              ? "已开启：登录时需要输入验证器 App 的 6 位动态码。"
              : "未开启：建议管理员开启，防止账号被暴力破解。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!totpEnabled && !pending && (
            <Button onClick={handleSetup} disabled={busy}>
              生成密钥
            </Button>
          )}

          {pending && (
            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm">
                在 Google Authenticator / 1Password 等 App 中添加：
              </p>
              <p className="break-all rounded bg-muted p-2 text-xs">
                {pending.otpauthUrl}
              </p>
              <p className="text-xs text-muted-foreground">
                密钥（也可手动输入）：<code>{pending.secret}</code>
              </p>
              <div className="space-y-2">
                <Label htmlFor="enable-code">输入 App 显示的 6 位验证码</Label>
                <div className="flex gap-2">
                  <Input
                    id="enable-code"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  />
                  <Button onClick={handleEnable} disabled={busy}>
                    开启
                  </Button>
                </div>
              </div>
            </div>
          )}

          {totpEnabled && (
            <div className="space-y-2">
              <Label htmlFor="disable-code">
                输入当前 6 位验证码后关闭
              </Label>
              <div className="flex gap-2">
                <Input
                  id="disable-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
                <Button variant="destructive" onClick={handleDisable} disabled={busy}>
                  关闭
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailCheck className="h-5 w-5 text-emerald-500" />
            邮箱验证码登录（Email OTP）
          </CardTitle>
          <CardDescription>
            平台安全策略：<strong>所有账号登录强制邮箱验证码</strong>，不可关闭。
            登录时除密码外，还需输入发送到 {user?.email ?? "注册邮箱"}{" "}
            的 6 位验证码（可与 TOTP 并存）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            已强制开启 ✓
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-muted-foreground" />
            绑定 / 更换钱包
          </CardTitle>
          <CardDescription>
            更换绑定的 Solana 钱包地址，需要邮箱验证码确认。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wallet">Solana 钱包地址</Label>
            <Input
              id="wallet"
              placeholder="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              maxLength={6}
              placeholder="6 位邮箱验证码"
              value={walletCode}
              onChange={(e) => setWalletCode(e.target.value.replace(/\D/g, ""))}
            />
            <Button
              variant="outline"
              className="shrink-0"
              onClick={handleSendWalletCode}
              disabled={walletBusy || walletCooldown > 0}
            >
              {walletCooldown > 0
                ? `${walletCooldown}s 后可重发`
                : walletBusy
                  ? "发送中..."
                  : "发送验证码"}
            </Button>
          </div>
          <Button onClick={handleBindWallet} disabled={walletBusy}>
            绑定钱包
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
