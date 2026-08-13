"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useMemo, useState } from "react";
import { changePassword, fetchSession, sendEmailOtpCode } from "@/lib/api";
import { useUserStore } from "@/stores/user-store";

export default function ChangePasswordPage() {
  const router = useRouter();
  const setAuth = useUserStore((state) => state.setAuth);
  const user = useUserStore((state) => state.user);
  const requiresCode = user?.emailOtpEnabled !== false;
  const schema = useMemo(
    () =>
      z
        .object({
          currentPassword: z.string().min(6, "请输入当前密码"),
          newPassword: z.string().min(8, "新密码至少 8 位"),
          confirmPassword: z.string().min(8, "请再次输入新密码"),
          emailCode: requiresCode
            ? z.string().regex(/^\d{6}$/, "请输入 6 位邮箱验证码")
            : z.string().optional(),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
          message: "两次输入的新密码不一致",
          path: ["confirmPassword"],
        }),
    [requiresCode],
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
      toast.success("验证码已发送到邮箱，请查收");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "验证码发送失败");
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
      toast.success("密码修改成功");
      router.push(
        result.user.role === "USER" ? "/user/upload" : "/admin/files",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "修改密码失败");
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
          <CardTitle className="text-center text-xl">设置新密码</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            首次登录或使用初始密码时，需要先设置新密码才能继续操作。
          </p>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">当前密码</Label>
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
              <Label htmlFor="newPassword">新密码</Label>
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
              <Label htmlFor="confirmPassword">确认新密码</Label>
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
              <Label htmlFor="emailCode">邮箱验证码</Label>
              <div className="flex gap-2">
                <Input
                  id="emailCode"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位邮箱验证码"
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
                    ? `${cooldown}s 后可重发`
                    : sendingCode
                      ? "发送中..."
                      : "发送验证码"}
                </Button>
              </div>
              {errors.emailCode && (
                <p className="text-sm text-destructive">
                  {errors.emailCode.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                验证码将发送到 {user?.email ?? "你的注册邮箱"}
              </p>
            </div>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "提交中..." : "修改密码"}
            </Button>
          </form>
        </CardContent>
    </Card>
  );
}
