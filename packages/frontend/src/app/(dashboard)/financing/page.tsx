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
import { formatUsdc } from "@/lib/http";

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
    setBusy(true);
    try {
      await applyFinancing({
        invoiceId,
        invoiceAmount,
        amount,
        discountRate: 800,
        tenorDays: Number(tenorDays),
      });
      toast.success(t("financing.applied"));
      setInvoiceId("");
      setInvoiceAmount("");
      setAmount("");
      setTenorDays("30");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("financing.applyFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleRepay = async (id: string) => {
    try {
      await repayFinancing(id);
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-[#00E676]" />
          <h1 className="font-mono text-xl font-bold">{t("financing.title")}</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1 h-3 w-3" />
          {t("common.refresh")}
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
                    const usdc = Math.round(Number(ocrAmt) * 1e6).toString();
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
                value={invoiceAmount ? (Number(invoiceAmount) / 1e6).toFixed(2) : ""}
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
                  setAmount(v ? Math.round(Number(v) * 1e6).toString() : "");
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
            <p className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
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
                    <th className="py-2 pr-4">{t("common.status")}</th>
                    <th className="py-2 pr-4">{t("financing.createdAt")}</th>
                    <th className="py-2">{t("common.actions")}</th>
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
