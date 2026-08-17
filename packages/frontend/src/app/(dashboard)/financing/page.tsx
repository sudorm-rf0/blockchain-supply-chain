"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Banknote, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  applyFinancing,
  fetchMyFinancing,
  repayFinancing,
  type FinancingRecord,
} from "@/lib/api";
import { getFiles, type FileRecord } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { formatUsdc, parseUsdcInput } from "@/lib/http";
import Turnstile from "@/components/Turnstile";
import { TURNSTILE_SITE_KEY } from "@/lib/env";

export default function FinancingPage() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<FinancingRecord[]>([]);
  const [invoices, setInvoices] = useState<FileRecord[]>([]);
  const [invoiceId, setInvoiceId] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [amount, setAmount] = useState("");
  const [tenorDays, setTenorDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const [reqRes, fileRes] = await Promise.all([
        fetchMyFinancing(),
        getFiles({ page: 1, limit: 50, status: "APPROVED" }),
      ]);
      setRequests(reqRes.items);
      setInvoices(fileRes.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("financing.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleApply = async () => {
    if (!invoiceId) {
      toast.error(t("financing.selectInvoice"));
      return;
    }
    if (!/^\d+$/.test(invoiceAmount) || !/^\d+$/.test(amount)) {
      toast.error(t("financing.amountInvalid"));
      return;
    }
    if (!/^\d+$/.test(tenorDays) || Number(tenorDays) < 1) {
      toast.error(t("financing.tenorInvalid"));
      return;
    }
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      toast.error(t("financing.captchaRequired"));
      return;
    }
    setBusy(true);
    try {
      await applyFinancing({
        invoiceId,
        invoiceAmount,
        amount,
        discountRate: 800,
        tenorDays: Number(tenorDays),
        turnstileToken: turnstileToken || undefined,
      });
      toast.success(t("financing.applied"));
      setInvoiceId("");
      setInvoiceAmount("");
      setAmount("");
      setTenorDays("30");
      setTurnstileToken("");
      setCaptchaKey((k) => k + 1);
      await load();
    } catch (error) {
      setTurnstileToken("");
      setCaptchaKey((k) => k + 1);
      toast.error(error instanceof Error ? error.message : t("financing.applyFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleRepay = async (id: string) => {
    if (!window.confirm(t("financing.repayConfirm"))) return;
    // 审计 H-4：需提供链上还款转账签名（申请人 USDC → 平台钱包），后端校验后才标记已还清。
    const txSignature = window.prompt(t("financing.repayTxPrompt") || "请输入还款链上转账交易签名（USDC 转账到平台钱包）");
    if (!txSignature || !/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(txSignature)) {
      toast.error(t("financing.txSignatureInvalid") || "交易签名格式不正确");
      return;
    }
    try {
      await repayFinancing(id, txSignature);
      toast.success(t("financing.repaid"));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("financing.actionFailed"));
    }
  };

  const statusBadge = (status: string) =>
    status === "APPROVED"
      ? "border border-[#00E676]/40 bg-[#00E676]/10 text-[#00E676]"
      : status === "REJECTED"
        ? "border border-red-500/40 bg-red-500/10 text-red-500"
        : status === "REPAID"
          ? "border border-sky-500/40 bg-sky-500/10 text-sky-500"
          : "border border-amber-500/40 bg-amber-500/10 text-amber-500";

  const statusLabel = (status: string) =>
    t(`financing.status.${status}`, { defaultValue: status });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-[#00E676]" />
          <h1 className="font-mono text-xl font-bold">{t("financing.title")}</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1 h-3 w-3" />
          {t("refresh")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("financing.applyTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("financing.selectInvoice")}</Label>
            <select
              value={invoiceId}
              onChange={(e) => {
                const f = invoices.find((x) => x.id === e.target.value);
                setInvoiceId(e.target.value);
                if (f) {
                  const ocrAmt =
                    f.authResult?.keyFields?.amount?.numeric;
                  if (ocrAmt) {
                    const usdc = parseUsdcInput(String(ocrAmt)) ?? "0";
                    setInvoiceAmount(usdc);
                  } else {
                    setInvoiceAmount("");
                  }
                }
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t("financing.selectPlaceholder")}</option>
              {invoices.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.filename}
                </option>
              ))}
            </select>
            {invoices.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("financing.noInvoice")}</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("financing.invoiceAmountUsdc")}</Label>
              <Input
                value={invoiceAmount ? formatUsdc(invoiceAmount) : ""}
                disabled
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("financing.amountUsdc")}</Label>
              <Input
                inputMode="decimal"
                placeholder="0.00"
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d.]/g, "");
                  setAmount(v ? (parseUsdcInput(v) ?? "") : "");
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("financing.tenorDays")}</Label>
              <Input
                inputMode="numeric"
                value={tenorDays}
                onChange={(e) => setTenorDays(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("financing.discountHint", { rate: "8%" })}
          </p>
          <Turnstile key={captchaKey} action="sensitive" onVerify={setTurnstileToken} />
          <Button disabled={busy} onClick={() => void handleApply()}>
            {busy ? t("financing.submitting") : t("financing.submit")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("financing.myRequests")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>
          ) : requests.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("financing.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4">{t("financing.invoice")}</th>
                    <th className="py-2 pr-4">{t("financing.amount")}</th>
                    <th className="py-2 pr-4">{t("financing.tenor")}</th>
                    <th className="py-2 pr-4">{t("status")}</th>
                    <th className="py-2 pr-4">{t("financing.createdAt")}</th>
                    <th className="py-2">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="max-w-[180px] truncate py-2 pr-4">{r.invoiceFilename ?? "-"}</td>
                      <td className="py-2 pr-4 font-mono">{formatUsdc(BigInt(r.amount))}</td>
                      <td className="py-2 pr-4">{r.tenorDays}{t("financing.days")}</td>
                      <td className="py-2 pr-4">
                        <Badge className={statusBadge(r.status)}>{statusLabel(r.status)}</Badge>
                      </td>
                      <td className="py-2 pr-4">{formatDateTime(r.createdAt)}</td>
                      <td className="py-2">
                        {r.status === "APPROVED" && (
                          <Button size="sm" variant="outline" onClick={() => void handleRepay(r.id)}>
                            {t("financing.repay")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
