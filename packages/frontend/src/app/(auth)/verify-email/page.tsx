"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { SpamWarningDialog, shouldShowSpamHint } from "@/components/SpamWarningDialog";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = (searchParams.get("email") ?? "").trim();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [spamOpen, setSpamOpen] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      toast.error(t("verifyEmail.error.enterCode"));
      return;
    }
    if (!email) {
      toast.error(t("verifyEmail.error.missingEmail"));
      return;
    }
    setSubmitting(true);
    try {
      await verifyEmail(email, code);
      toast.success(t("verifyEmail.toast.success"));
      if (shouldShowSpamHint()) setSpamOpen(true);
      router.push("/login");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("verifyEmail.error.failed"));
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
      toast.success(t("verifyEmail.toast.resent"));
      if (shouldShowSpamHint()) setSpamOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("verifyEmail.error.sendFailed"));
    } finally {
      setResending(false);
    }
  };

  return (
    <>
    <Card className="w-full shadow-xl">
      <CardHeader>
        <CardTitle className="text-center text-xl">{t("verifyEmail.title")}</CardTitle>
        <CardDescription className="text-center">
          {t("verifyEmail.descriptionPrefix")}{" "}
          <span className="font-medium">{email || t("verifyEmail.yourEmail")}</span>{" "}
          {t("verifyEmail.descriptionSuffix")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">{t("verifyEmail.code")}</Label>
            <Input
              id="code"
              inputMode="numeric"
              maxLength={6}
              placeholder={t("verifyEmail.codePlaceholder")}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={submitting || code.length !== 6}
          >
            {submitting ? t("verifyEmail.submitting") : t("verifyEmail.submit")}
          </Button>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("verifyEmail.noCode")}</span>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={onResend}
              disabled={resending || cooldown > 0}
            >
              {cooldown > 0
                ? t("verifyEmail.cooldown", { s: cooldown })
                : resending
                  ? t("verifyEmail.sending")
                  : t("verifyEmail.resend")}
            </Button>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            {t("verifyEmail.expiryHint")}{" "}
            <Link href="/login" className="text-primary hover:underline">
              {t("verifyEmail.login")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
      <SpamWarningDialog open={spamOpen} onOpenChange={setSpamOpen} />
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  );
}
