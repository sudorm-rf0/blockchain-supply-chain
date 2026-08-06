"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff } from "lucide-react";
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
import { disableTotp, enableTotp, setupTotp } from "@/lib/api";
import { useUserStore } from "@/stores/user-store";

export default function SecurityPage() {
  const user = useUserStore((state) => state.user);
  const setAuth = useUserStore((state) => state.setAuth);
  const [pending, setPending] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const totpEnabled = user?.totpEnabled ?? false;

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
    </div>
  );
}
