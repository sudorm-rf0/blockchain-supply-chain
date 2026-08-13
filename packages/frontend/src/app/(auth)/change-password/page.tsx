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

export default function ChangePasswordPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const setAuth = useUserStore((state) => state.setAuth);
  const user = useUserStore((state) => state.user);
  const requiresCode = user?.emailOtpEnabled !== false;
  const schema = useMemo(
    () =>
      z
        .object({
          currentPassword: z.string().min(6, t("changePassword.validation.currentPassword")),
          newPassword: z.string().min(8, t("changePassword.validation.newPassword")),
          confirmPassword: z.string().min(8, t("changePassword.validation.confirmPassword")),
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
  const {
    register,
    handleSubmit,
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("changePassword.error.sendCodeFailed"));
    } finally {
      setSendingCode(false);
    }
  };

  const onSubmit = async (values: ChangePasswordForm) => {
    try {
      const result = await changePassword(
        values.currentPassword,
        values.newPassword,
        values.emailCode || undefined,
      );
      setAuth(result.user);
      toast.success(t("changePassword.toast.success"));
      router.push(
        result.user.role === "USER" ? "/user/upload" : "/admin/files",
      );
    } catch (error) {
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
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t("changePassword.submitting") : t("changePassword.submit")}
            </Button>
          </form>
        </CardContent>
    </Card>
  );
}
