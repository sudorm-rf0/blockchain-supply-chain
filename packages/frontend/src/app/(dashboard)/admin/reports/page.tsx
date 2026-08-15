"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchOrdersReport,
  fetchFinancingReport,
  fetchAuditReport,
  ordersExportUrl,
  financingExportUrl,
  auditExportUrl,
  type ReportResponse,
} from "@/lib/reports-api";
import { formatDateTime } from "@/lib/format";

type Tab = "orders" | "financing" | "audit";

export default function ReportsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("orders");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { from: from || undefined, to: to || undefined };
      if (tab === "orders") setData(await fetchOrdersReport(params));
      else if (tab === "financing") setData(await fetchFinancingReport(params));
      else setData(await fetchAuditReport(params));
    } finally {
      setLoading(false);
    }
  }, [tab, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportUrl = tab === "orders" ? ordersExportUrl : tab === "financing" ? financingExportUrl : auditExportUrl;

  const summary = data?.summary;
  const items = data?.items ?? [];

  const columns =
    tab === "orders"
      ? [t("panels.reports.dealId"), t("panels.reports.status"), t("panels.reports.amount"), t("panels.reports.createdAt")]
      : tab === "financing"
        ? [t("panels.reports.invoiceId"), t("panels.reports.status"), t("panels.reports.amount"), t("panels.reports.discountRate"), t("panels.reports.createdAt")]
        : [t("panels.reports.action"), t("panels.reports.actor"), t("panels.reports.createdAt")];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-2 font-mono text-xl font-bold">
          <BarChart3 className="h-5 w-5 text-[#00E676]" />
          {t("panels.reports.title")}
        </h1>
        <div className="flex items-center gap-2">
          {(["orders", "financing", "audit"] as const).map((k) => (
            <Button key={k} variant={tab === k ? "default" : "outline"} size="sm" onClick={() => setTab(k)}>
              {t(`panels.reports.tab${k === "orders" ? "Orders" : k === "financing" ? "Financing" : "Audit"}`)}
            </Button>
          ))}
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("panels.reports.from")}</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-44" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("panels.reports.to")}</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-44" />
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("panels.reports.filter")}
          </Button>
          <Button variant="outline" size="sm" asChild className="ml-auto">
            <a href={exportUrl({ from: from || undefined, to: to || undefined })} target="_blank" rel="noreferrer">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {t("panels.reports.export")}
            </a>
          </Button>
        </CardContent>
      </Card>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("panels.reports.total")}</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{summary.total}</div></CardContent>
          </Card>
          {summary.amountTotal != null && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("panels.reports.amountTotal")}</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold text-[#00E676]">{summary.amountTotal}</div></CardContent>
            </Card>
          )}
          {summary.downPaymentTotal != null && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("panels.reports.downPaymentTotal")}</CardTitle></CardHeader>
              <CardContent><div className="text-xl font-bold">{summary.downPaymentTotal}</div></CardContent>
            </Card>
          )}
          {summary.invoiceAmountTotal != null && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("panels.reports.invoiceAmountTotal")}</CardTitle></CardHeader>
              <CardContent><div className="text-xl font-bold">{summary.invoiceAmountTotal}</div></CardContent>
            </Card>
          )}
          {(summary.byStatus || summary.byAction) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{summary.byStatus ? t("panels.reports.byStatus") : t("panels.reports.byAction")}</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                {Object.entries(summary.byStatus ?? summary.byAction ?? {}).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="font-mono">{k}</span>
                    <span className="font-semibold">{v}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">{t("panels.reports.loading")}</p>
          ) : items.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t("panels.reports.empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead key={c}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id}>
                    {tab === "orders" && (
                      <>
                        <TableCell className="font-mono text-xs">{String(it.dealId ?? "")}</TableCell>
                        <TableCell><span className="font-mono text-xs">{String(it.status ?? "")}</span></TableCell>
                        <TableCell className="font-mono text-xs">{String(it.amount ?? "")}</TableCell>
                        <TableCell className="font-mono text-xs">{it.createdAt ? formatDateTime(String(it.createdAt)) : ""}</TableCell>
                      </>
                    )}
                    {tab === "financing" && (
                      <>
                        <TableCell className="font-mono text-xs">{String(it.invoiceId ?? "")}</TableCell>
                        <TableCell><span className="font-mono text-xs">{String(it.status ?? "")}</span></TableCell>
                        <TableCell className="font-mono text-xs">{String(it.amount ?? "")}</TableCell>
                        <TableCell className="font-mono text-xs">{String(it.discountRate ?? "")}% · {String(it.tenorDays ?? "")}d</TableCell>
                        <TableCell className="font-mono text-xs">{it.createdAt ? formatDateTime(String(it.createdAt)) : ""}</TableCell>
                      </>
                    )}
                    {tab === "audit" && (
                      <>
                        <TableCell><span className="font-mono text-xs">{String(it.action ?? "")}</span></TableCell>
                        <TableCell className="font-mono text-xs">{String(it.actorEmail ?? "")}</TableCell>
                        <TableCell className="font-mono text-xs">{it.createdAt ? formatDateTime(String(it.createdAt)) : ""}</TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
