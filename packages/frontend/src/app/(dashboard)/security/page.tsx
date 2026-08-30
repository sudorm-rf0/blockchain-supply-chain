"use client";

import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MailCheck, Monitor, ShieldCheck, ShieldOff, Wallet } from "lucide-react";
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
import { SensitiveCodeField } from "@/components/SensitiveCodeField";
import {
  bindWallet,
  disableTotp,
  enableTotp,
  sendEmailOtpCode,
  setupTotp,
} from "@/lib/api";
import { useUserStore } from "@/stores/user-store";
import { fetchSessions, revokeOtherSessions } from "@/lib/auth-api";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { parseUserAgent, COUNTRY_NAMES } from "@/lib/session-info";

export default function SecurityPage() {
  const { t } = useTranslation();
  const user = useUserStore((state) => state.user);
  const setAuth = useUserStore((state) => state.setAuth);
  const [pending, setPending] = useState<{
    secret: string;
    otpauthUrl: string;
    qrCodeDataUrl: string;
  } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
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
      toast.success(t("security.generateSuccess"));
    } catch {
      toast.error(t("security.generateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleEnable = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast.error(t("security.codeRequired"));
      return;
    }
    try {
      setBusy(true);
      await enableTotp(code);
      if (user) setAuth({ ...user, totpEnabled: true });
      setPending(null);
      setCode("");
      toast.success(t("security.totpEnabled"));
    } catch {
      toast.error(t("security.codeInvalid"));
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast.error(t("security.currentCodeRequired"));
      return;
    }
    try {
      setBusy(true);
      await disableTotp(code);
      if (user) setAuth({ ...user, totpEnabled: false });
      setCode("");
      toast.success(t("security.totpDisabled"));
    } catch {
      toast.error(t("security.codeInvalid"));
    } finally {
      setBusy(false);
    }
  };

  const handleSendWalletCode = async () => {
    setWalletBusy(true);
    try {
      const result = await sendEmailOtpCode();
      setWalletCooldown(result.cooldownSeconds ?? 60);
      toast.success(t("security.wallet.sendSuccess"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("security.wallet.sendFailed"));
    } finally {
      setWalletBusy(false);
    }
  };

  const handleBindWallet = async () => {
    const value = wallet.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
      toast.error(t("security.wallet.invalidAddress"));
      return;
    }
    if (!/^\d{6}$/.test(walletCode)) {
      toast.error(totpEnabled ? t("account.totpCodeRequired") : t("security.wallet.codeRequired"));
      return;
    }
    setWalletBusy(true);
    try {
      const updated = await bindWallet(value, walletCode);
      setAuth(updated);
      setWalletCode("");
      toast.success(t("security.wallet.bound"));
      // 方案A：USER 换绑钱包后进入 24h 冷静期（期间禁止提款/赎回）
      if (updated.role === "USER") {
        toast.info(t("security.wallet.cooldownHint"));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("security.wallet.bindFailed"));
    } finally {
      setWalletBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">{t("security.title")}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {totpEnabled ? (
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
            ) : (
              <ShieldOff className="h-5 w-5 text-muted-foreground" />
            )}
            {t("security.totpTitle")}
          </CardTitle>
          <CardDescription>
            {totpEnabled ? t("security.totpEnabledDesc") : t("security.totpDisabledDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!totpEnabled && !pending && (
            <Button onClick={handleSetup} disabled={busy}>
              {t("security.generate")}
            </Button>
          )}

          {pending && (
            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm">{t("security.pendingSetup")}</p>
              {/* 二维码：扫码即可添加 */}
              <div className="flex flex-col items-center gap-2">
                {pending.qrCodeDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pending.qrCodeDataUrl}
                    alt="TOTP QR"
                    className="h-44 w-44 rounded-md border bg-white p-1"
                  />
                ) : null}
                <p className="text-center text-xs text-muted-foreground">
                  {t("security.qrHint")}
                </p>
              </div>
              {/* 备用：手动输入密钥 / 复制链接 */}
              <p className="text-xs text-muted-foreground">
                {t("security.secretHint")}<code>{pending.secret}</code>
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs">
                  {pending.otpauthUrl}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(pending.otpauthUrl);
                      setLinkCopied(true);
                      toast.success(t("security.copied"));
                    } catch {
                      toast.error(t("security.copyLink"));
                    }
                  }}
                >
                  {linkCopied ? t("security.copied") : t("security.copyLink")}
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="enable-code">{t("security.enableCodeLabel")}</Label>
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
                    {t("security.enable")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {totpEnabled && (
            <div className="space-y-2">
              <Label htmlFor="disable-code">{t("security.disableCodeLabel")}</Label>
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
                  {t("security.disable")}
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
            {t("security.emailOtpTitle")}
          </CardTitle>
          <CardDescription>
            <Trans
              i18nKey="security.emailOtpDescription"
              values={{ email: user?.email ?? t("security.emailOtpRegisteredEmail") }}
              components={{ strong: <strong /> }}
            />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            {t("security.emailOtpEnabled")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-muted-foreground" />
            {t("security.walletTitle")}
          </CardTitle>
          <CardDescription>{t("security.walletDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wallet">{t("security.walletAddressLabel")}</Label>
            <Input
              id="wallet"
              placeholder="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
            />
          </div>
          <SensitiveCodeField
            id="walletCode"
            totpEnabled={totpEnabled}
            value={walletCode}
            onChange={setWalletCode}
            onSend={() => void handleSendWalletCode()}
            sending={walletBusy}
            cooldown={walletCooldown}
          />
          <Button onClick={handleBindWallet} disabled={walletBusy}>
            {t("security.walletBind")}
          </Button>
        </CardContent>
      </Card>

      <SessionCard />
    </div>
  );
}

function SessionCard() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<
    Array<{
      id: string;
      createdAt: string;
      expiresAt: string;
      current: boolean;
      ipAddress?: string | null;
      geoCountry?: string | null;
      userAgent?: string | null;
    }>
  >([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setSessions(await fetchSessions());
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const handleRevokeOthers = async () => {
    setBusy(true);
    try {
      await revokeOtherSessions();
      toast.success(t("panels.security.revoked"));
      await load();
    } catch {
      toast.error(t("panels.security.revoked"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-[#00E676]" />
          {t("panels.security.sessions")}
        </CardTitle>
        <CardDescription>{t("panels.security.activeSessions")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y divide-border/60 rounded-md border border-border/60">
          {sessions.slice(0, 10).map((s) => {
            const info = parseUserAgent(s.userAgent);
            const deviceLabel =
              info.deviceType === "mobile"
                ? t("panels.security.device.mobile")
                : info.deviceType === "tablet"
                  ? t("panels.security.device.tablet")
                  : info.deviceType === "pc"
                    ? t("panels.security.device.pc")
                    : t("panels.security.device.unknown");
            const geo = s.geoCountry ? (COUNTRY_NAMES[s.geoCountry] ?? s.geoCountry) : t("panels.security.geoUnknown");
            return (
              <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                {/* 左侧：登录时间 */}
                <div className="min-w-0">
                  <p className="font-mono text-xs text-foreground">
                    {s.createdAt ? formatDateTime(s.createdAt) : "-"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("panels.security.expires")} {formatDateTime(s.expiresAt)}
                  </p>
                </div>
                {/* 右侧：位置 + 设备信息 */}
                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <span title={s.ipAddress ?? undefined}>
                    {geo} · {deviceLabel} · {info.browser} · {info.os}
                  </span>
                  {s.current && (
                    <Badge variant="outline" className="border-[#00E676]/40 bg-[#00E676]/10 text-[#00E676]">
                      {t("panels.security.current")}
                    </Badge>
                  )}
                </div>
              </li>
            );
          })}
          {sessions.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t("panels.integrations.empty")}</li>
          )}
        </ul>
        <Button variant="outline" size="sm" className="text-destructive" disabled={busy} onClick={() => void handleRevokeOthers()}>
          {t("panels.security.revokeAll")}
        </Button>
      </CardContent>
    </Card>
  );
}
