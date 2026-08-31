"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { forgotPassword, resetPassword } from "@/lib/api";
import Turnstile from "@/components/Turnstile";
import { TURNSTILE_SITE_KEY } from "@/lib/env";

const emailSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4),
  newPassword: z
    .string()
    .min(8)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, "密码需≥8位且包含大小写字母、数字和特殊符号"),
});

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<"email" | "reset" | "done">("email");
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  const emailForm = useForm({ resolver: zodResolver(emailSchema), defaultValues: { email: "" } });
  const resetForm = useForm({ resolver: zodResolver(resetSchema), defaultValues: { email: "", code: "", newPassword: "" } });

  const onSend = async (values: { email: string }) => {
    try {
      if (TURNSTILE_SITE_KEY && !turnstileToken) {
        emailForm.setError("root", { message: "请完成人机验证" });
        return;
      }
      await forgotPassword(values.email, turnstileToken);
      setEmail(values.email);
      resetForm.setValue("email", values.email);
      setStep("reset");
    } catch (e) {
      emailForm.setError("root", { message: e instanceof Error ? e.message : "发送失败" });
    }
  };

  const onReset = async (values: { email: string; code: string; newPassword: string }) => {
    try {
      await resetPassword(values.email, values.code, values.newPassword);
      setStep("done");
    } catch (e) {
      resetForm.setError("root", { message: e instanceof Error ? e.message : "重置失败" });
    }
  };

  return (
    <Card className="w-full shadow-xl">
      <CardHeader>
        <CardTitle className="text-center text-xl">找回密码</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">

        {step === "email" && (
          <form onSubmit={emailForm.handleSubmit(onSend)} className="space-y-2.5">
            <Input type="email" placeholder="请输入邮箱" {...emailForm.register("email")} />
            {emailForm.formState.errors.email && <p className="text-sm text-red-500">{emailForm.formState.errors.email.message}</p>}
            {emailForm.formState.errors.root && <p className="text-sm text-red-500">{emailForm.formState.errors.root.message}</p>}
            <Turnstile action="forgot" onVerify={setTurnstileToken} />
            <Button type="submit" className="w-full">发送验证码</Button>
            <Link href="/login" className="block text-center text-sm text-muted-foreground hover:underline">返回登录</Link>
          </form>
        )}

        {step === "reset" && (
          <form onSubmit={resetForm.handleSubmit(onReset)} className="space-y-2.5">
            <Label className="text-sm text-muted-foreground">验证码已发送到 {email}，请查收（5分钟内有效）</Label>
            <Input type="text" placeholder="验证码" {...resetForm.register("code")} />
            <Input type="password" placeholder="新密码（≥8位，含大小写/数字/特殊符号）" {...resetForm.register("newPassword")} />
            {resetForm.formState.errors.newPassword && <p className="text-sm text-red-500">{resetForm.formState.errors.newPassword.message}</p>}
            {resetForm.formState.errors.root && <p className="text-sm text-red-500">{resetForm.formState.errors.root.message}</p>}
            <Button type="submit" className="w-full">重置密码</Button>
          </form>
        )}

        {step === "done" && (
          <div className="space-y-4 text-center">
            <p className="text-green-600">密码已重置，请用新密码登录</p>
            <Link href="/login" className="inline-block rounded bg-primary px-4 py-2 text-white">去登录</Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
