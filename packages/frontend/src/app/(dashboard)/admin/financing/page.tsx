"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Banknote, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchAdminFinancing, reviewFinancing, type FinancingRecord } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { formatUsdc } from "@/lib/http";

export default function AdminFinancingPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<FinancingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchAdminFinancing();
      setItems(res.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("financing.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReview = async (id: string, action: "approve" | "reject") => {
    setBusyId(id);
    try {
      // 审计 H-4：放款必须提供平台钱包→申请人的链上 USDC 转账签名。
      let txSignature: string | undefined;
      if (action === "approve") {
        txSignature = window.prompt(t("financing.approveTxPrompt") || "请输入放款链上转账交易签名（平台钱包 USDC 转账给申请人）") ?? undefined;
        if (!txSignature || !/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(txSignature)) {
          toast.error(t("financing.txSignatureInvalid") || "交易签名格式不正确");
          return;
        }
      }
      await reviewFinancing(id, action, txSignature);
      toast.success(
        action === "approve" ? t("financing.approved") : t("financing.rejected"),
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("financing.actionFailed"));
    } finally {
      setBusyId(null);
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-[#00E676]" />
          <h1 className="font-mono text-xl font-bold">{t("financing.adminTitle")}</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1 h-3 w-3" />
          {t("refresh")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("financing.allRequests")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("financing.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4">{t("financing.applicant")}</th>
                    <th className="py-2 pr-4">{t("financing.invoice")}</th>
                    <th className="py-2 pr-4">{t("financing.invoiceAmount")}</th>
                    <th className="py-2 pr-4">{t("financing.amount")}</th>
                    <th className="py-2 pr-4">{t("financing.discount")}</th>
                    <th className="py-2 pr-4">{t("financing.tenor")}</th>
                    <th className="py-2 pr-4">{t("status")}</th>
                    <th className="py-2 pr-4">{t("financing.createdAt")}</th>
                    <th className="py-2">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <p>{r.applicantName ?? "-"}</p>
                        <p className="text-xs text-muted-foreground">{r.applicantEmail ?? ""}</p>
                      </td>
                      <td className="max-w-[160px] truncate py-2 pr-4">{r.invoiceFilename ?? "-"}</td>
                      <td className="py-2 pr-4 font-mono">{formatUsdc(BigInt(r.invoiceAmount))}</td>
                      <td className="py-2 pr-4 font-mono">{formatUsdc(BigInt(r.amount))}</td>
                      <td className="py-2 pr-4">{(r.discountRate / 100).toFixed(1)}%</td>
                      <td className="py-2 pr-4">{r.tenorDays}{t("financing.days")}</td>
                      <td className="py-2 pr-4">
                        <Badge className={statusBadge(r.status)}>{statusLabel(r.status)}</Badge>
                      </td>
                      <td className="py-2 pr-4">{formatDateTime(r.createdAt)}</td>
                      <td className="py-2">
                        {r.status === "PENDING" && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              disabled={busyId !== null}
                              onClick={() => void handleReview(r.id, "approve")}
                            >
                              {t("approve")}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busyId !== null}
                              onClick={() => void handleReview(r.id, "reject")}
                            >
                              {t("reject")}
                            </Button>
                          </div>
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
