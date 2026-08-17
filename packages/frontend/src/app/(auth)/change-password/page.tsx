"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useMemo, useState } from "react";
import { changePassword, fetchSession, sendEmailOtpCode } from "@/lib/api";
import { useUserStore } from "@/stores/user-store";
import Turnstile from "@/components/Turnstile";
import { SpamWarningDialog, shouldShowSpamHint } from "@/components/SpamWarningDialog";
import { TURNSTILE_SITE_KEY } from "@/lib/env";

export default function ChangePasswordPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const setAuth = useUserStore((state) => state.setAuth);
  const user = useUserStore((state) => state.user);
  // 修改密码必须邮箱验证码；仅「强制首登改密 + 引导账号无真实邮箱」豁免
  const requiresCode =
    user?.emailOtpEnabled !== false || user?.mustChangePassword !== true;
  const schema = useMemo(
    () =>
      z
        .object({
          currentPassword: z.string().min(6, t("changePassword.validation.currentPassword")),
          newPassword: z
            .string()
            .regex(
              /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/,
              t("register.validation.passwordPolicy"),
            ),
          confirmPassword: z
            .string()
            .regex(
              /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/,
              t("register.validation.passwordPolicy"),
            ),
          emailCode: requiresCode
            ? z.string().regex(/^\d{6}$/, t("changePassword.validation.emailCode"))
            : z.string().optional(),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
          message: t("changePassword.validation.passwordMismatch"),
          path: ["confirmPassword"],
        }),
    [requiresCode, t],
  );
  type ChangePasswordForm = z.infer<typeof schema>;
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [ready, setReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const [spamOpen, setSpamOpen] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
      emailCode: "",
    },
  });

  const newPasswordValue = watch("newPassword") ?? "";
  const pwPolicy = [
    { key: "length", label: t("register.policy.length"), ok: newPasswordValue.length >= 8 },
    { key: "lower", label: t("register.policy.lower"), ok: /[a-z]/.test(newPasswordValue) },
    { key: "upper", label: t("register.policy.upper"), ok: /[A-Z]/.test(newPasswordValue) },
    { key: "digit", label: t("register.policy.digit"), ok: /\d/.test(newPasswordValue) },
    { key: "symbol", label: t("register.policy.symbol"), ok: /[^A-Za-z0-9]/.test(newPasswordValue) },
  ];
  const pwOkCount = pwPolicy.filter((item) => item.ok).length;
  const pwStrength = newPasswordValue.length === 0 ? 0 : Math.round((pwOkCount / pwPolicy.length) * 100);
  const pwStrengthClass =
    pwStrength >= 100 ? "bg-green-500" : pwStrength >= 60 ? "bg-amber-500" : "bg-red-500";
  const pwValid = pwOkCount === pwPolicy.length;


  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);
  // 直达/刷新本页时恢复会话，避免 user 为空导致“邮箱验证码”要求误判（引导账号豁免）
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

  const handleSendCode = async () => {
    setSendingCode(true);
    try {
      const result = await sendEmailOtpCode();
      setCooldown(result.cooldownSeconds ?? 60);
      toast.success(t("changePassword.toast.codeSent"));
      if (shouldShowSpamHint()) setSpamOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("changePassword.error.sendCodeFailed"));
    } finally {
      setSendingCode(false);
    }
  };

  const onSubmit = async (values: ChangePasswordForm) => {
    try {
      if (TURNSTILE_SITE_KEY && !turnstileToken) {
        toast.error(t("account.captchaRequired"));
        return;
      }
      const result = await changePassword(
        values.currentPassword,
        values.newPassword,
        values.emailCode || undefined,
        turnstileToken || undefined,
      );
      setAuth(result.user);
      setTurnstileToken("");
      setCaptchaKey((k) => k + 1);
      toast.success(t("changePassword.toast.success"));
      router.push(
        result.user.role === "USER" ? "/user/upload" : "/admin/files",
      );
    } catch (error) {
      setTurnstileToken("");
      setCaptchaKey((k) => k + 1);
      toast.error(error instanceof Error ? error.message : t("changePassword.error.failed"));
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
    <>
        <Card className="w-full shadow-xl">
        <CardHeader>
          <CardTitle className="text-center text-xl">{t("changePassword.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            {t("changePassword.notice")}
          </p>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">{t("changePassword.currentPassword")}</Label>
              <Input
                id="currentPassword"
                type="password"
                {...register("currentPassword")}
              />
              {errors.currentPassword && (
                <p className="text-sm text-destructive">
                  {errors.currentPassword.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">{t("changePassword.newPassword")}</Label>
              <Input
                id="newPassword"
                type="password"
                {...register("newPassword")}
              />
              {newPasswordValue.length > 0 && (
                <div className="space-y-1.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${pwStrengthClass}`}
                      style={{ width: `${pwStrength}%` }}
                    />
                  </div>
                  <ul className="space-y-0.5 text-xs">
                    {pwPolicy.map((item) => (
                      <li
                        key={item.key}
                        className={item.ok ? "text-green-600" : "text-muted-foreground"}
                      >
                        {item.ok ? "✓ " : "○ "}
                        {item.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {errors.newPassword && (
                <p className="text-sm text-destructive">
                  {errors.newPassword.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t("changePassword.confirmPassword")}</Label>
              <Input
                id="confirmPassword"
                type="password"
                {...register("confirmPassword")}
              />
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>
            {requiresCode && (
            <div className="space-y-2">
              <Label htmlFor="emailCode">{t("changePassword.emailCode")}</Label>
              <div className="flex gap-2">
                <Input
                  id="emailCode"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={t("changePassword.emailCodePlaceholder")}
                  {...register("emailCode")}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={handleSendCode}
                  disabled={sendingCode || cooldown > 0}
                >
                  {cooldown > 0
                    ? t("changePassword.cooldown", { s: cooldown })
                    : sendingCode
                      ? t("changePassword.sending")
                      : t("changePassword.sendCode")}
                </Button>
              </div>
              {errors.emailCode && (
                <p className="text-sm text-destructive">
                  {errors.emailCode.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t("changePassword.codeWillSend", {
                  email: user?.email ?? t("changePassword.yourEmail"),
                })}
              </p>
            </div>
            )}
            <Turnstile key={captchaKey} action="sensitive" onVerify={setTurnstileToken} />
            <Button type="submit" className="w-full" disabled={isSubmitting || !pwValid}>
              {isSubmitting ? t("changePassword.submitting") : t("changePassword.submit")}
            </Button>
          </form>
        </CardContent>
    </Card>
      <SpamWarningDialog open={spamOpen} onOpenChange={setSpamOpen} />
    </>
  );
}
