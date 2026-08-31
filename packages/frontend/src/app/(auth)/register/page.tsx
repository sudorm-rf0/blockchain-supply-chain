"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { register as registerApi } from "@/lib/api";
import Turnstile from "@/components/Turnstile";
import { TURNSTILE_SITE_KEY } from "@/lib/env";
import { useUserStore } from "@/stores/user-store";

export default function RegisterPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const setAuth = useUserStore((state) => state.setAuth);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const schema = useMemo(
    () =>
      z
        .object({
          name: z.string().min(1, t("register.validation.name")),
          company: z.string().max(200).optional().or(z.literal("")),
          agreeTerms: z.boolean().refine((v) => v === true, t("register.validation.agreeTerms")),
          email: z.string().email(t("register.validation.email")),
          password: z
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
          wallet: z
            .string()
            .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, t("register.validation.wallet"))
            .optional()
            .or(z.literal("")),
          inviteCode: z
            .string()
            .regex(/^[A-Za-z0-9]{6}$/, t("register.validation.inviteCode")),
        })
        .refine((data) => data.password === data.confirmPassword, {
          message: t("register.validation.passwordMismatch"),
          path: ["confirmPassword"],
        }),
    [t],
  );
  type RegisterForm = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      company: "",
      agreeTerms: false,
      email: "",
      password: "",
      confirmPassword: "",
      inviteCode: "",
    },
  });

  const passwordValue = watch("password") ?? "";
  const policy = [
    { key: "length", label: t("register.policy.length"), ok: passwordValue.length >= 8 },
    { key: "lower", label: t("register.policy.lower"), ok: /[a-z]/.test(passwordValue) },
    { key: "upper", label: t("register.policy.upper"), ok: /[A-Z]/.test(passwordValue) },
    { key: "digit", label: t("register.policy.digit"), ok: /\d/.test(passwordValue) },
    { key: "symbol", label: t("register.policy.symbol"), ok: /[^A-Za-z0-9]/.test(passwordValue) },
  ];
  const satisfiedCount = policy.filter((item) => item.ok).length;
  const strength = passwordValue.length === 0 ? 0 : Math.round((satisfiedCount / policy.length) * 100);
  const strengthClass =
    strength >= 100 ? "bg-green-500" : strength >= 60 ? "bg-amber-500" : "bg-red-500";
  const passwordValid = satisfiedCount === policy.length;

  const onSubmit = async (values: RegisterForm) => {
    try {
      if (TURNSTILE_SITE_KEY && !turnstileToken) {
        toast.error(t("register.error.turnstile"));
        return;
      }
      const result = await registerApi({
        name: values.name,
        company: values.company || undefined,
        agreeTerms: values.agreeTerms,
        email: values.email,
        password: values.password,
        wallet: values.wallet || undefined,
        inviteCode: values.inviteCode.trim(),
        turnstileToken: turnstileToken || undefined,
        lang: i18n.language,
      });
      if (result.requiresEmailVerification) {
        // 防垃圾注册：注册后需先输入邮箱验证码激活账号
        toast.success(t("register.toast.verifySent"));
        if (result.devCode && process.env.NODE_ENV !== "production") {
          toast.info(t("register.toast.devCode", { code: result.devCode }));
        }
        router.push(
          `/verify-email?email=${encodeURIComponent(values.email)}`,
        );
        return;
      }
      const { user, mustChangePassword } = result;
      setAuth({ ...user, mustChangePassword: mustChangePassword ?? false });
      toast.success(t("register.toast.success"));
      router.push("/user/upload");
    } catch (error) {
      setCaptchaKey((k) => k + 1);
      setTurnstileToken("");
      toast.error(error instanceof Error ? error.message : t("register.error.failed"));
    }
  };

  return (
        <Card className="w-full shadow-xl">
        <CardHeader className="px-5">
          <CardTitle className="text-center text-xl">{t("register.title")}</CardTitle>
        </CardHeader>
        <CardContent className="px-5">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("register.name")}</Label>
              <Input id="name" {...register("name")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="company">{t("register.company")}</Label>
              <Input id="company" placeholder={t("register.companyPlaceholder")} {...register("company")} />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t("register.email")}</Label>
              <Input id="email" type="email" {...register("email")} />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("register.password")}</Label>
              <Input id="password" type="password" {...register("password")} />
              {passwordValue.length > 0 && (
                <div className="space-y-1.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${strengthClass}`}
                      style={{ width: `${strength}%` }}
                    />
                  </div>
                  <ul className="space-y-0.5 text-xs">
                    {policy.map((item) => (
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
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t("register.confirmPassword")}</Label>
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
            <div className="space-y-2">
              <Label htmlFor="inviteCode">{t("register.inviteCode")}</Label>
              <Input
                id="inviteCode"
                placeholder={t("register.inviteCodePlaceholder")}
                maxLength={6}
                autoCapitalize="characters"
                {...register("inviteCode")}
              />
              {errors.inviteCode && (
                <p className="text-sm text-destructive">{errors.inviteCode.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="wallet">{t("register.wallet")}</Label>
              <Input
                id="wallet"
                placeholder={t("register.walletPlaceholder")}
                {...register("wallet")}
              />
            </div>
            <Turnstile key={captchaKey} action="signup" onVerify={setTurnstileToken} />
              <div className="flex items-start gap-2 py-1">
                <input id="agreeTerms" type="checkbox" className="mt-1 h-4 w-4" {...register("agreeTerms")} />
                <Label htmlFor="agreeTerms" className="text-sm text-muted-foreground">
                  {t("register.agreeTerms")}{" "}
                  <Link href="/terms" className="underline">{t("register.termsLink")}</Link>
                  {" / "}
                  <Link href="/privacy" className="underline">{t("register.privacyLink")}</Link>
                </Label>
              </div>
              {errors.agreeTerms && <p className="text-sm text-red-500">{errors.agreeTerms.message}</p>}

            <Button
              type="submit"
              className="w-full"
              disabled={
                isSubmitting || !passwordValid || (!!TURNSTILE_SITE_KEY && !turnstileToken)
              }
            >
              {isSubmitting ? t("register.submitting") : t("register.submit")}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {t("register.haveAccount")}{" "}
              <Link href="/login" className="text-primary hover:underline">
                {t("register.goLogin")}
              </Link>
            </p>
          </form>
        </CardContent>
    </Card>
  );
}
