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
  const { t } = useTranslation();
  const router = useRouter();
  const setAuth = useUserStore((state) => state.setAuth);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const schema = useMemo(
    () =>
      z
        .object({
          name: z.string().min(1, t("register.validation.name")),
          email: z.string().email(t("register.validation.email")),
          password: z.string().min(6, t("register.validation.passwordMin")),
          confirmPassword: z.string().min(6, t("register.validation.passwordMin")),
          wallet: z
            .string()
            .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, t("register.validation.wallet"))
            .optional()
            .or(z.literal("")),
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
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (values: RegisterForm) => {
    try {
      if (TURNSTILE_SITE_KEY && !turnstileToken) {
        toast.error(t("register.error.turnstile"));
        return;
      }
      const result = await registerApi({
        name: values.name,
        email: values.email,
        password: values.password,
        wallet: values.wallet || undefined,
        turnstileToken: turnstileToken || undefined,
      });
      if (result.requiresEmailVerification) {
        // 防垃圾注册：注册后需先输入邮箱验证码激活账号
        toast.success(t("register.toast.verifySent"));
        if (result.devCode) {
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
        <CardHeader>
          <CardTitle className="text-center text-xl">{t("register.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("register.name")}</Label>
              <Input id="name" {...register("name")} />
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
              <Label htmlFor="wallet">{t("register.wallet")}</Label>
              <Input
                id="wallet"
                placeholder={t("register.walletPlaceholder")}
                {...register("wallet")}
              />
            </div>
            <Turnstile key={captchaKey} action="signup" onVerify={setTurnstileToken} />
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || (!!TURNSTILE_SITE_KEY && !turnstileToken)}
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
