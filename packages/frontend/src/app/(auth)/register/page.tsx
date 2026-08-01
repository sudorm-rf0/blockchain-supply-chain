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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { register as registerApi } from "@/lib/api";
import { useUserStore } from "@/stores/user-store";

const schema = z
  .object({
    name: z.string().min(1, "请输入姓名"),
    email: z.string().email("邮箱格式不正确"),
    password: z.string().min(6, "密码至少 6 位"),
    confirmPassword: z.string().min(6, "密码至少 6 位"),
    wallet: z.string().optional(),
    role: z.enum(["USER", "ADMIN"]),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"],
  });

type RegisterForm = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useUserStore((state) => state.setAuth);
  const [role, setRole] = useState<"USER" | "ADMIN">("USER");
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
      role: "USER",
    },
  });

  const onSubmit = async (values: RegisterForm) => {
    if (values.role === "ADMIN") {
      toast.error("管理员账号由平台分配，公开注册仅支持普通用户");
      return;
    }
    try {
      const { token, user } = await registerApi({
        name: values.name,
        email: values.email,
        password: values.password,
        wallet: values.wallet || undefined,
      });
      setAuth(user, token);
      toast.success("注册成功");
      router.push(user.role === "ADMIN" ? "/admin/files" : "/user/upload");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "注册失败");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <CardTitle className="text-center text-xl">注册</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">姓名</Label>
              <Input id="name" {...register("name")} />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input id="email" type="email" {...register("email")} />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input id="password" type="password" {...register("password")} />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">确认密码</Label>
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
              <Label htmlFor="wallet">钱包地址（可选）</Label>
              <Input
                id="wallet"
                placeholder="Solana 钱包公钥"
                {...register("wallet")}
              />
            </div>
            <div className="space-y-2">
              <Label>角色</Label>
              <Select
                value={role}
                onValueChange={(value) => setRole(value as "USER" | "ADMIN")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">普通用户</SelectItem>
                  <SelectItem value="ADMIN">管理员</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "注册中..." : "注册"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              已有账号？{" "}
              <Link href="/login" className="text-primary hover:underline">
                去登录
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
