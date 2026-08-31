"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { forgotPassword, resetPassword } from "@/lib/api";

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

  const emailForm = useForm({ resolver: zodResolver(emailSchema), defaultValues: { email: "" } });
  const resetForm = useForm({ resolver: zodResolver(resetSchema), defaultValues: { email: "", code: "", newPassword: "" } });

  const onSend = async (values: { email: string }) => {
    try {
      await forgotPassword(values.email);
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
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border p-8">
        <h1 className="mb-6 text-xl font-bold">找回密码</h1>

        {step === "email" && (
          <form onSubmit={emailForm.handleSubmit(onSend)} className="space-y-4">
            <input type="email" placeholder="请输入邮箱" {...emailForm.register("email")} className="w-full rounded border p-2" />
            {emailForm.formState.errors.email && <p className="text-sm text-red-500">{emailForm.formState.errors.email.message}</p>}
            {emailForm.formState.errors.root && <p className="text-sm text-red-500">{emailForm.formState.errors.root.message}</p>}
            <button type="submit" className="w-full rounded bg-primary p-2 text-white">发送验证码</button>
            <Link href="/login" className="block text-center text-sm text-muted-foreground hover:underline">返回登录</Link>
          </form>
        )}

        {step === "reset" && (
          <form onSubmit={resetForm.handleSubmit(onReset)} className="space-y-4">
            <p className="text-sm text-muted-foreground">验证码已发送到 {email}，请查收（5分钟内有效）</p>
            <input type="text" placeholder="验证码" {...resetForm.register("code")} className="w-full rounded border p-2" />
            <input type="password" placeholder="新密码（≥8位，含大小写/数字/特殊符号）" {...resetForm.register("newPassword")} className="w-full rounded border p-2" />
            {resetForm.formState.errors.newPassword && <p className="text-sm text-red-500">{resetForm.formState.errors.newPassword.message}</p>}
            {resetForm.formState.errors.root && <p className="text-sm text-red-500">{resetForm.formState.errors.root.message}</p>}
            <button type="submit" className="w-full rounded bg-primary p-2 text-white">重置密码</button>
          </form>
        )}

        {step === "done" && (
          <div className="space-y-4 text-center">
            <p className="text-green-600">密码已重置，请用新密码登录</p>
            <Link href="/login" className="inline-block rounded bg-primary px-4 py-2 text-white">去登录</Link>
          </div>
        )}
      </div>
    </div>
  );
}
