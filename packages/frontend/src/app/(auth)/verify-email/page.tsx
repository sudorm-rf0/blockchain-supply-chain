"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendEmailCode, verifyEmail } from "@/lib/api";

function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = (searchParams.get("email") ?? "").trim();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      toast.error("请输入 6 位验证码");
      return;
    }
    if (!email) {
      toast.error("缺少邮箱参数，请从注册页重新操作");
      return;
    }
    setSubmitting(true);
    try {
      await verifyEmail(email, code);
      toast.success("邮箱验证成功，账号已激活，请登录");
      router.push("/login");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "验证失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    if (!email || cooldown > 0) return;
    setResending(true);
    try {
      const result = await sendEmailCode(email);
      setCooldown(result.cooldownSeconds ?? 60);
      toast.success("验证码已重新发送，请查收");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送失败，请稍后重试");
    } finally {
      setResending(false);
    }
  };

  return (
    <Card className="w-full shadow-xl">
      <CardHeader>
        <CardTitle className="text-center text-xl">邮箱验证</CardTitle>
        <CardDescription className="text-center">
          已向 <span className="font-medium">{email || "你的邮箱"}</span>{" "}
          发送 6 位验证码，输入后账号即激活
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">验证码</Label>
            <Input
              id="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="6 位验证码"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={submitting || code.length !== 6}
          >
            {submitting ? "验证中..." : "验证并激活账号"}
          </Button>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>没收到验证码？</span>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={onResend}
              disabled={resending || cooldown > 0}
            >
              {cooldown > 0
                ? `${cooldown}s 后可重发`
                : resending
                  ? "发送中..."
                  : "重新发送"}
            </Button>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            验证码 5 分钟内有效，且只能使用一次。验证完成后前往{" "}
            <Link href="/login" className="text-primary hover:underline">
              登录
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  );
}
