"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Lock, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changeEmail,
  changePassword,
  fetchSession,
  sendEmailCode,
  sendEmailOtpCode,
} from "@/lib/api";
import { useUserStore } from "@/stores/user-store";

export default function AccountPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const setAuth = useUserStore((state) => state.setAuth);
  const user = useUserStore((state) => state.user);
  const [ready, setReady] = useState(false);

  // 直达/刷新本页时恢复会话
  useEffect(() => {
    let active = true;
    void (async () => {
      const u = await fetchSession();
      if (!active) return;
      setReady(true);
      if (!u) router.replace("/login");
    })();
    return () => {
      active = false;
    };
  }, [router]);

  // 邮箱修改
  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [emailSending, setEmailSending] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);

  // 密码修改
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwCode, setPwCode] = useState("");
  const [pwCooldown, setPwCooldown] = useState(0);
  const [pwSending, setPwSending] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  // 引导账号（emailOtpEnabled=false）改密豁免验证码
  const requiresEmailCode = user?.emailOtpEnabled !== false;

  useEffect(() => {
    if (emailCooldown <= 0) return;
    const timer = setInterval(() => setEmailCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [emailCooldown]);

  useEffect(() => {
    if (pwCooldown <= 0) return;
    const timer = setInterval(() => setPwCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [pwCooldown]);

  const handleSendEmailCode = async () => {
    const email = newEmail.trim();
    if (!email) {
      toast.error(t("account.emailRequired"));
      return;
    }
    setEmailSending(true);
    try {
      const r = await sendEmailCode(email);
      setEmailCooldown(r.cooldownSeconds ?? 60);
      toast.success(t("account.emailSent"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("account.sendFailed"));
    } finally {
      setEmailSending(false);
    }
  };

  const handleChangeEmail = async () => {
    const email = newEmail.trim();
    if (!email || !/^\d{6}$/.test(emailCode)) {
      toast.error(t("account.emailCodeRequired"));
      return;
    }
    setEmailBusy(true);
    try {
      const result = await changeEmail(email, emailCode);
      setAuth(result.user);
      toast.success(t("account.emailChanged"));
      setNewEmail("");
      setEmailCode("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("account.emailChangeFailed"));
    } finally {
      setEmailBusy(false);
    }
  };

  const handleSendPwCode = async () => {
    setPwSending(true);
    try {
      const r = await sendEmailOtpCode();
      setPwCooldown(r.cooldownSeconds ?? 60);
      toast.success(t("account.pwCodeSent"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("account.sendFailed"));
    } finally {
      setPwSending(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      toast.error(t("account.newPasswordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("account.passwordMismatch"));
      return;
    }
    if (requiresEmailCode && !/^\d{6}$/.test(pwCode)) {
      toast.error(t("account.emailCodeRequired"));
      return;
    }
    setPwBusy(true);
    try {
      const result = await changePassword(
        currentPassword,
        newPassword,
        requiresEmailCode ? pwCode : undefined,
      );
      setAuth(result.user);
      toast.success(t("account.pwChanged"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwCode("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("account.pwChangeFailed"));
    } finally {
      setPwBusy(false);
    }
  };

  if (!ready || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-[#00E676]" />
        <h1 className="font-mono text-xl font-bold">{t("account.title")}</h1>
      </div>

      {/* 修改邮箱 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-[#00E676]" />
            {t("account.changeEmail")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("account.currentEmail")}</Label>
            <Input value={user.email ?? ""} readOnly disabled className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newEmail">{t("account.newEmail")}</Label>
            <Input
              id="newEmail"
              type="email"
              value={newEmail}
              maxLength={254}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t("account.newEmailPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emailCode">{t("account.emailCode")}</Label>
            <div className="flex gap-2">
              <Input
                id="emailCode"
                inputMode="numeric"
                maxLength={6}
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                placeholder={t("account.codePlaceholder")}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                disabled={emailSending || emailCooldown > 0}
                onClick={() => void handleSendEmailCode()}
              >
                {emailCooldown > 0
                  ? `${emailCooldown}s`
                  : emailSending
                    ? t("account.sending")
                    : t("account.sendCode")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("account.emailCodeHint", { email: newEmail || t("account.newEmail") })}
            </p>
          </div>
          <Button className="w-full" disabled={emailBusy} onClick={() => void handleChangeEmail()}>
            {emailBusy ? t("account.submitting") : t("account.confirmChangeEmail")}
          </Button>
        </CardContent>
      </Card>

      {/* 修改密码 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-[#00E676]" />
            {t("account.changePassword")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">{t("account.currentPassword")}</Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">{t("account.newPassword")}</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t("account.confirmPassword")}</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {requiresEmailCode && (
            <div className="space-y-2">
              <Label htmlFor="pwCode">{t("account.emailCode")}</Label>
              <div className="flex gap-2">
                <Input
                  id="pwCode"
                  inputMode="numeric"
                  maxLength={6}
                  value={pwCode}
                  onChange={(e) => setPwCode(e.target.value.replace(/\D/g, ""))}
                  placeholder={t("account.codePlaceholder")}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  disabled={pwSending || pwCooldown > 0}
                  onClick={() => void handleSendPwCode()}
                >
                  {pwCooldown > 0
                    ? `${pwCooldown}s`
                    : pwSending
                      ? t("account.sending")
                      : t("account.sendCode")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("account.pwCodeHint")}
              </p>
            </div>
          )}
          <Button className="w-full" disabled={pwBusy} onClick={() => void handleChangePassword()}>
            {pwBusy ? t("account.submitting") : t("account.confirmChangePassword")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
