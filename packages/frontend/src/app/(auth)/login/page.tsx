"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/lib/api";
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
  const [totpCode, setTotpCode] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: LoginForm) => {
    try {
      const result = await login(
        values.email,
        values.password,
        totpCode || undefined,
      );
      if (result.requiresTotp) {
        setRequiresTotp(true);
        toast.info("该账号已开启两步验证，请输入 6 位验证码");
        return;
      }
      const { user, mustChangePassword } = result;
      setAuth({ ...user, mustChangePassword: mustChangePassword ?? false });
      toast.success("登录成功");
      router.push(
        mustChangePassword
          ? "/change-password"
          : user.role === "ADMIN"
            ? "/admin/files"
            : "/user/upload",
      );
    } catch (error) {
      const hint = error instanceof Error ? error.message : "";
      if (
        hint.includes("fetch") ||
        hint.includes("网络") ||
        hint.includes("Network") ||
        hint.includes("timeout") ||
        hint.includes("Abort")
      ) {
        toast.error("网络连接失败，请检查网络后重试");
      } else if (requiresTotp) {
        toast.error("验证码错误");
      } else {
        toast.error("邮箱或密码错误");
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <CardTitle className="text-center text-xl">登录</CardTitle>
        </CardHeader>
        <CardContent>
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
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "登录中..." : requiresTotp ? "验证并登录" : "登录"}
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
    </div>
  );
}
