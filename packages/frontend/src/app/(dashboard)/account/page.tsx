"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Lock, KeyRound, MessageSquareText, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  changeEmail,
  changeName,
  changePassword,
  deleteAccount,
  fetchSession,
  logout as logoutApi,
  sendEmailCode,
  sendEmailOtpCode,
  submitFeedback,
} from "@/lib/api";
import { useUserStore } from "@/stores/user-store";
import Turnstile from "@/components/Turnstile";
import { SpamWarningDialog, shouldShowSpamHint } from "@/components/SpamWarningDialog";
import { TURNSTILE_SITE_KEY } from "@/lib/env";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function AccountPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const setAuth = useUserStore((state) => state.setAuth);
  const user = useUserStore((state) => state.user);
  const [ready, setReady] = useState(false);

  // 意见反馈
  const [feedbackContent, setFeedbackContent] = useState("");
  const [feedbackContact, setFeedbackContact] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  const handleSubmitFeedback = async () => {
    const content = feedbackContent.trim();
    if (!content || feedbackBusy) return;
    setFeedbackBusy(true);
    try {
      await submitFeedback({ content, contact: feedbackContact.trim() || undefined });
      toast.success(t("account.feedback.success"));
      setFeedbackContent("");
      setFeedbackContact("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("account.feedback.failed"));
    } finally {
      setFeedbackBusy(false);
    }
  };

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

  // 名称修改（需邮箱验证码）
  const [newName, setNewName] = useState("");
  const [nameCode, setNameCode] = useState("");
  const [nameCooldown, setNameCooldown] = useState(0);
  const [nameSending, setNameSending] = useState(false);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameTurnstile, setNameTurnstile] = useState("");
  const [nameCaptchaKey, setNameCaptchaKey] = useState(0);

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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [emailTurnstile, setEmailTurnstile] = useState("");
  const [emailCaptchaKey, setEmailCaptchaKey] = useState(0);
  const [pwTurnstile, setPwTurnstile] = useState("");
  const [pwCaptchaKey, setPwCaptchaKey] = useState(0);
  const [deleteTurnstile, setDeleteTurnstile] = useState("");
  const [deleteCaptchaKey, setDeleteCaptchaKey] = useState(0);
  const [spamOpen, setSpamOpen] = useState(false);

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

  useEffect(() => {
    if (nameCooldown <= 0) return;
    const timer = setInterval(() => setNameCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [nameCooldown]);

  const handleSendNameCode = async () => {
    setNameSending(true);
    try {
      const r = await sendEmailOtpCode();
      setNameCooldown(r.cooldownSeconds ?? 60);
      toast.success(t("account.emailSent"));
      if (shouldShowSpamHint()) setSpamOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("account.sendFailed"));
    } finally {
      setNameSending(false);
    }
  };

  const handleChangeName = async () => {
    const name = newName.trim();
    if (name.length < 2 || name.length > 100) {
      toast.error(t("account.nameRequired"));
      return;
    }
    if (!/^\d{6}$/.test(nameCode)) {
      toast.error(t("account.emailCodeRequired"));
      return;
    }
    if (TURNSTILE_SITE_KEY && !nameTurnstile) {
      toast.error(t("account.captchaRequired"));
      return;
    }
    setNameBusy(true);
    try {
      const result = await changeName(name, nameCode, nameTurnstile || undefined);
      setAuth(result.user);
      toast.success(t("account.nameChanged"));
      setNewName("");
      setNameCode("");
      setNameTurnstile("");
      setNameCaptchaKey((k) => k + 1);
    } catch (error) {
      setNameTurnstile("");
      setNameCaptchaKey((k) => k + 1);
      toast.error(error instanceof Error ? error.message : t("account.nameChangeFailed"));
    } finally {
      setNameBusy(false);
    }
  };

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
      if (shouldShowSpamHint()) setSpamOpen(true);
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
    if (TURNSTILE_SITE_KEY && !emailTurnstile) {
      toast.error(t("account.captchaRequired"));
      return;
    }
    setEmailBusy(true);
    try {
      const result = await changeEmail(email, emailCode, emailTurnstile || undefined);
      setAuth(result.user);
      toast.success(t("account.emailChanged"));
      setNewEmail("");
      setEmailCode("");
      setEmailTurnstile("");
      setEmailCaptchaKey((k) => k + 1);
    } catch (error) {
      setEmailTurnstile("");
      setEmailCaptchaKey((k) => k + 1);
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
      if (shouldShowSpamHint()) setSpamOpen(true);
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
    if (TURNSTILE_SITE_KEY && !pwTurnstile) {
      toast.error(t("account.captchaRequired"));
      return;
    }
    setPwBusy(true);
    try {
      const result = await changePassword(
        currentPassword,
        newPassword,
        requiresEmailCode ? pwCode : undefined,
        pwTurnstile || undefined,
      );
      setAuth(result.user);
      toast.success(t("account.pwChanged"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwCode("");
      setPwTurnstile("");
      setPwCaptchaKey((k) => k + 1);
    } catch (error) {
      setPwTurnstile("");
      setPwCaptchaKey((k) => k + 1);
      toast.error(error instanceof Error ? error.message : t("account.pwChangeFailed"));
    } finally {
      setPwBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm.trim() !== t("account.deleteConfirmWord")) {
      toast.error(t("account.deleteConfirmMismatch"));
      return;
    }
    if (TURNSTILE_SITE_KEY && !deleteTurnstile) {
      toast.error(t("account.captchaRequired"));
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount(deleteTurnstile || undefined);
      toast.success(t("account.deleted"));
      await logoutApi();
      useUserStore.getState().logout();
      router.replace("/login");
    } catch (error) {
      setDeleteTurnstile("");
      setDeleteCaptchaKey((k) => k + 1);
      toast.error(error instanceof Error ? error.message : t("account.deleteFailed"));
      setDeleting(false);
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

      {/* 修改名称 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound className="h-4 w-4 text-[#00E676]" />
            {t("account.changeName")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("account.currentName")}</Label>
            <Input value={user.name ?? ""} readOnly disabled className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newName">{t("account.newName")}</Label>
            <Input
              id="newName"
              value={newName}
              maxLength={100}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("account.newNamePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nameCode">{t("account.emailCode")}</Label>
            <div className="flex gap-2">
              <Input
                id="nameCode"
                inputMode="numeric"
                maxLength={6}
                value={nameCode}
                onChange={(e) => setNameCode(e.target.value.replace(/\D/g, ""))}
                placeholder={t("account.codePlaceholder")}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                disabled={nameSending || nameCooldown > 0}
                onClick={() => void handleSendNameCode()}
              >
                {nameCooldown > 0
                  ? `${nameCooldown}s`
                  : nameSending
                    ? t("account.sending")
                    : t("account.sendCode")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("account.nameCodeHint")}
            </p>
          </div>
          <Turnstile key={nameCaptchaKey} action="sensitive" onVerify={setNameTurnstile} />
          <Button className="w-full" disabled={nameBusy} onClick={() => void handleChangeName()}>
            {nameBusy ? t("account.submitting") : t("account.confirmChangeName")}
          </Button>
        </CardContent>
      </Card>

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
          <Turnstile key={emailCaptchaKey} action="sensitive" onVerify={setEmailTurnstile} />
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
          <Turnstile key={pwCaptchaKey} action="sensitive" onVerify={setPwTurnstile} />
          <Button className="w-full" disabled={pwBusy} onClick={() => void handleChangePassword()}>
            {pwBusy ? t("account.submitting") : t("account.confirmChangePassword")}
          </Button>
        </CardContent>
      </Card>

      {/* 意见反馈 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquareText className="h-4 w-4 text-[#00E676]" />
            {t("account.feedback.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("account.feedback.desc")}</p>
          <div className="space-y-2">
            <Label htmlFor="feedbackContent">{t("account.feedback.contentLabel")}</Label>
            <Textarea
              id="feedbackContent"
              value={feedbackContent}
              onChange={(e) => setFeedbackContent(e.target.value)}
              placeholder={t("account.feedback.contentPlaceholder")}
              maxLength={2000}
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="feedbackContact">{t("account.feedback.contactLabel")}</Label>
            <Input
              id="feedbackContact"
              value={feedbackContact}
              onChange={(e) => setFeedbackContact(e.target.value)}
              placeholder={t("account.feedback.contactPlaceholder")}
              maxLength={200}
            />
          </div>
          <Button
            className="w-full"
            disabled={feedbackBusy || !feedbackContent.trim()}
            onClick={() => void handleSubmitFeedback()}
          >
            {feedbackBusy
              ? t("account.feedback.submitting")
              : t("account.feedback.submit")}
          </Button>
        </CardContent>
      </Card>

      {/* 注销账号 */}
      <Card className="border-red-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-red-500">
            <Trash2 className="h-4 w-4" />
            {t("account.deleteTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("account.deleteWarning")}</p>
          <Button
            variant="destructive"
            className="border border-red-500/40 bg-red-500/10 text-red-500 hover:bg-red-500/20"
            onClick={() => {
              setDeleteConfirm("");
              setDeleteOpen(true);
            }}
          >
            {t("account.deleteButton")}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("account.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("account.deleteConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-confirm">{t("account.deleteConfirmLabel")}</Label>
            <Input
              id="delete-confirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={t("account.deleteConfirmWord")}
            />
          </div>
          <Turnstile key={deleteCaptchaKey} action="sensitive" onVerify={setDeleteTurnstile} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || deleteConfirm.trim() !== t("account.deleteConfirmWord")}
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteAccount();
              }}
              className="border border-red-500/40 bg-red-500/10 text-red-500 hover:bg-red-500/20"
            >
              {deleting ? t("account.deleting") : t("account.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SpamWarningDialog open={spamOpen} onOpenChange={setSpamOpen} />
    </div>
  );
}
