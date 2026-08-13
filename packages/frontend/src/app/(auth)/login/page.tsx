"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, sendEmailCode } from "@/lib/api";
import Turnstile from "@/components/Turnstile";
import { TURNSTILE_SITE_KEY } from "@/lib/env";
import { useUserStore } from "@/stores/user-store";

const schema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(6, "密码至少 6 位"),
});

type LoginForm = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useUserStore((state) => state.setAuth);
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [requiresEmailOtp, setRequiresEmailOtp] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [emailOtpCode, setEmailOtpCode] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
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

  useEffect(() => {
    if (emailOtpCooldown <= 0) return;
    const timer = setInterval(() => setEmailOtpCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [emailOtpCooldown]);

  const handleSendEmailOtp = async () => {
    if (!emailValue) {
      toast.error("请先输入邮箱");
      return;
    }
    setSendingEmailOtp(true);
    try {
      const result = await sendEmailCode(emailValue);
      setEmailOtpCooldown(result.cooldownSeconds ?? 60);
      toast.success("验证码已发送到邮箱，请查收");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "验证码发送失败");
    } finally {
      setSendingEmailOtp(false);
    }
  };

  const onSubmit = async (values: LoginForm) => {
    try {
      if (TURNSTILE_SITE_KEY && !turnstileToken) {
        toast.error("请先完成人机验证");
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
        toast.info("验证码已发送到邮箱，请输入 6 位邮箱验证码");
        if (result.devCode) {
          toast.info(`开发模式验证码：${result.devCode}`);
        }
        return;
      }
      if (result.requiresTotp) {
        setRequiresTotp(true);
        setCaptchaKey((k) => k + 1);
        setTurnstileToken("");
        toast.info("该账号已开启两步验证，请输入 6 位验证码");
        return;
      }
      const { user, mustChangePassword } = result;
      setAuth({ ...user, mustChangePassword: mustChangePassword ?? false });
      toast.success("登录成功");
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
        toast.error("邮箱尚未验证，请先完成邮箱验证后登录");
      } else if (
        hint.includes("fetch") ||
        hint.includes("网络") ||
        hint.includes("Network") ||
        hint.includes("timeout") ||
        hint.includes("Abort")
      ) {
        toast.error("网络连接失败，请检查网络后重试");
      } else if (requiresTotp || requiresEmailOtp) {
        toast.error("验证码错误");
      } else {
        toast.error("邮箱或密码错误");
      }
    }
  };

  return (
        <Card className="w-full shadow-xl">
        <CardHeader>
          <CardTitle className="text-center text-xl">登录</CardTitle>
        </CardHeader>
        <CardContent>
          {unverifiedEmail && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              该邮箱尚未验证，请先完成邮箱验证后登录。{" "}
              <Link
                href={`/verify-email?email=${encodeURIComponent(unverifiedEmail)}`}
                className="font-medium underline"
              >
                去验证邮箱
              </Link>
            </div>
          )}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
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
              <Label htmlFor="password">密码</Label>
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
                <Label htmlFor="email-otp">邮箱验证码</Label>
                <div className="flex gap-2">
                  <Input
                    id="email-otp"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6 位邮箱验证码"
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
                      ? `${emailOtpCooldown}s 后可重发`
                      : sendingEmailOtp
                        ? "发送中..."
                        : "发送验证码"}
                  </Button>
                </div>
              </div>
            )}
            {requiresTotp && (
              <div className="space-y-2">
                <Label htmlFor="totp">两步验证码</Label>
                <Input
                  id="totp"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位验证码"
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
                ? "登录中..."
                : requiresEmailOtp || requiresTotp
                  ? "验证并登录"
                  : "登录"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              还没有账号？{" "}
              <Link href="/register" className="text-primary hover:underline">
                去注册
              </Link>
            </p>
          </form>
        </CardContent>
    </Card>
  );
}
