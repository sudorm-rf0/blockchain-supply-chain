"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, sendEmailCode } from "@/lib/api";
import Turnstile from "@/components/Turnstile";
import { SpamWarningDialog, shouldShowSpamHint } from "@/components/SpamWarningDialog";
import { TURNSTILE_SITE_KEY } from "@/lib/env";
import { useUserStore } from "@/stores/user-store";

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const setAuth = useUserStore((state) => state.setAuth);
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [requiresEmailOtp, setRequiresEmailOtp] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [emailOtpCode, setEmailOtpCode] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const schema = useMemo(
    () =>
      z.object({
        email: z.string().email(t("login.validation.email")),
        password: z.string().min(6, t("login.validation.passwordMin")),
      }),
    [t],
  );
  type LoginForm = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  const emailValue = watch("email");
  const [emailOtpCooldown, setEmailOtpCooldown] = useState(0);
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [spamOpen, setSpamOpen] = useState(false);

  useEffect(() => {
    if (emailOtpCooldown <= 0) return;
    const timer = setInterval(() => setEmailOtpCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [emailOtpCooldown]);

  const handleSendEmailOtp = async () => {
    if (!emailValue) {
      toast.error(t("login.error.enterEmail"));
      return;
    }
    setSendingEmailOtp(true);
    try {
      const result = await sendEmailCode(emailValue);
      setEmailOtpCooldown(result.cooldownSeconds ?? 60);
      toast.success(t("login.toast.emailCodeSent"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("login.error.sendCodeFailed"));
    } finally {
      setSendingEmailOtp(false);
    }
  };

  const onSubmit = async (values: LoginForm) => {
    try {
      if (TURNSTILE_SITE_KEY && !turnstileToken) {
        toast.error(t("login.error.turnstile"));
        return;
      }
      setUnverifiedEmail(null);
      const result = await login(
        values.email,
        values.password,
        totpCode || undefined,
        emailOtpCode || undefined,
        turnstileToken || undefined,
      );
      if (result.requiresEmailOtp) {
        setRequiresEmailOtp(true);
        setEmailOtpCooldown(60);
        setCaptchaKey((k) => k + 1);
        setTurnstileToken("");
        toast.info(t("login.toast.emailOtpRequired"));
        if (shouldShowSpamHint()) setSpamOpen(true);
        if (result.devCode) {
          toast.info(t("login.toast.devCode", { code: result.devCode }));
        }
        return;
      }
      if (result.requiresTotp) {
        setRequiresTotp(true);
        setCaptchaKey((k) => k + 1);
        setTurnstileToken("");
        toast.info(t("login.toast.totpRequired"));
        return;
      }
      const { user, mustChangePassword } = result;
      setAuth({ ...user, mustChangePassword: mustChangePassword ?? false });
      toast.success(t("login.toast.success"));
      router.push(
        mustChangePassword
          ? "/change-password"
          : user.role === "USER"
            ? "/user/upload"
            : "/admin/files",
      );
    } catch (error) {
      setCaptchaKey((k) => k + 1);
      setTurnstileToken("");
      const hint = error instanceof Error ? error.message : "";
      if (hint.includes("邮箱尚未验证")) {
        setUnverifiedEmail(values.email);
        toast.error(t("login.toast.unverified"));
      } else if (
        hint.includes("fetch") ||
        hint.includes("网络") ||
        hint.includes("Network") ||
        hint.includes("timeout") ||
        hint.includes("Abort")
      ) {
        toast.error(t("login.toast.networkError"));
      } else if (requiresTotp || requiresEmailOtp) {
        toast.error(t("login.error.verificationCode"));
      } else {
        toast.error(t("login.error.invalidCredentials"));
      }
    }
  };

  return (
    <>
        <Card className="w-full shadow-xl">
        <CardHeader>
          <CardTitle className="text-center text-xl">{t("login.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {unverifiedEmail && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              {t("login.unverifiedNotice")}{" "}
              <Link
                href={`/verify-email?email=${encodeURIComponent(unverifiedEmail)}`}
                className="font-medium underline"
              >
                {t("login.goVerifyEmail")}
              </Link>
            </div>
          )}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("login.email")}</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("login.password")}</Label>
              <Input
                id="password"
                type="password"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>
            {requiresEmailOtp && (
              <div className="space-y-2">
                <Label htmlFor="email-otp">{t("login.emailOtp")}</Label>
                <div className="flex gap-2">
                  <Input
                    id="email-otp"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder={t("login.emailOtpPlaceholder")}
                    value={emailOtpCode}
                    onChange={(e) =>
                      setEmailOtpCode(e.target.value.replace(/\D/g, ""))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={handleSendEmailOtp}
                    disabled={sendingEmailOtp || emailOtpCooldown > 0}
                  >
                    {emailOtpCooldown > 0
                      ? t("login.cooldown", { s: emailOtpCooldown })
                      : sendingEmailOtp
                        ? t("login.sending")
                        : t("login.sendCode")}
                  </Button>
                </div>
              </div>
            )}
            {requiresTotp && (
              <div className="space-y-2">
                <Label htmlFor="totp">{t("login.totp")}</Label>
                <Input
                  id="totp"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={t("login.otpPlaceholder")}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            )}
            <Turnstile key={captchaKey} action="login" onVerify={setTurnstileToken} />
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || (!!TURNSTILE_SITE_KEY && !turnstileToken)}
            >
              {isSubmitting
                ? t("login.submitting")
                : requiresEmailOtp || requiresTotp
                  ? t("login.verifyAndLogin")
                  : t("login.submit")}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {t("login.noAccount")}{" "}
              <Link href="/register" className="text-primary hover:underline">
                {t("login.goRegister")}
              </Link>
            </p>
            <p className="text-center text-xs text-muted-foreground">
              <Link href="/verify" className="underline-offset-4 hover:underline">
                {t("onchain.verify.entry")} · {t("onchain.trace.entry")}
              </Link>
            </p>
          </form>
        </CardContent>
    </Card>
      <SpamWarningDialog open={spamOpen} onOpenChange={setSpamOpen} />
    </>
  );
}
