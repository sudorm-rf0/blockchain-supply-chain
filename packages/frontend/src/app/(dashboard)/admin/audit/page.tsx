"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw, Search, LogIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  exportAuditLogs,
  fetchAuditLogs,
  type AuditLogRecord,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const LIMIT = 20;

export default function AuditLogsPage() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [targetType, setTargetType] = useState("ALL");
  const [action, setAction] = useState<string>("");
  const [actorEmail, setActorEmail] = useState("");
  const [keyword, setKeyword] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const actionLabel = (action: string): string => {
    const labels: Record<string, string> = {
      FILE_APPROVED: t("audit.action.fileApproved"),
      FILE_REJECTED: t("audit.action.fileRejected"),
      FILE_DELETED: t("audit.action.fileDeleted"),
      TRADE_CREATED: t("audit.action.tradeCreated"),
      TRADE_FUNDED: t("audit.action.tradeFunded"),
      TRADE_ADVANCED: t("audit.action.tradeAdvanced"),
      TRADE_REPAID: t("audit.action.tradeRepaid"),
      TRADE_DEFAULTED: t("audit.action.tradeDefaulted"),
      WITHDRAW_REQUESTED: t("audit.action.withdrawRequested"),
      WITHDRAW_EXECUTED: t("audit.action.withdrawExecuted"),
    };
    return labels[action] ?? action;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAuditLogs({
        page,
        limit: LIMIT,
        targetType: targetType === "ALL" ? undefined : targetType,
        action: action || undefined,
        actorEmail: actorEmail.trim() || undefined,
        keyword: keyword.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      setLogs(data.items);
      setTotal(data.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("audit.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, targetType, action, actorEmail, keyword, from, to, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilter = () => {
    setPage(1);
    void load();
  };

  const showLoginOnly = () => {
    setAction((prev) => (prev === "AUTH_LOGIN" ? "" : "AUTH_LOGIN"));
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportAuditLogs({
        targetType: targetType === "ALL" ? undefined : targetType,
        action: action || undefined,
        actorEmail: actorEmail.trim() || undefined,
        keyword: keyword.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit-logs.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("audit.loadFailed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t("audit.title")}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExport()}
            disabled={exporting}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t("audit.export")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t("refresh")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-3">
        <Select value={targetType} onValueChange={setTargetType}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("audit.filterAll")}</SelectItem>
            <SelectItem value="FILE">{t("audit.filterFile")}</SelectItem>
            <SelectItem value="TRADE">{t("audit.filterTrade")}</SelectItem>
            <SelectItem value="WITHDRAW">{t("audit.filterWithdraw")}</SelectItem>
            <SelectItem value="SYSTEM">{t("audit.filterAll")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {t("audit.filterActorEmail")}
          </p>
          <Input
            className="h-9 w-48"
            value={actorEmail}
            onChange={(e) => setActorEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("audit.filterKeyword")}</p>
          <Input
            className="h-9 w-48"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("audit.filterFrom")}</p>
          <Input
            type="date"
            className="h-9 w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("audit.filterTo")}</p>
          <Input
            type="date"
            className="h-9 w-40"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={applyFilter}>
          <Search className="mr-1.5 h-3.5 w-3.5" />
          {t("audit.search")}
        </Button>
        <Button
          size="sm"
          variant={action === "AUTH_LOGIN" ? "default" : "outline"}
          onClick={showLoginOnly}
        >
          <LogIn className="mr-1.5 h-3.5 w-3.5" />
          {t("audit.filterLogin")}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("audit.loading")}</p>
      ) : logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("audit.empty")}</p>
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {logs.map((log) => (
            <div key={log.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-mono text-xs text-muted-foreground">
                  {formatDateTime(log.createdAt)}
                </p>
                <Badge variant="secondary">{actionLabel(log.action)}</Badge>
              </div>
              <p className="mt-1 truncate text-sm">
                {log.actorEmail ?? log.actorId ?? "-"}
              </p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {log.targetType}:{log.targetId.slice(0, 12)}
              </p>
              <p className="mt-1 truncate font-mono text-xs">
                {log.metadata ? JSON.stringify(log.metadata) : "-"}
              </p>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-md border md:block">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("audit.colTime")}</TableHead>
                <TableHead>{t("audit.colActor")}</TableHead>
                <TableHead>{t("audit.colAction")}</TableHead>
                <TableHead>{t("audit.colTarget")}</TableHead>
                <TableHead>{t("audit.colDetail")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(log.createdAt)}
                  </TableCell>
                  <TableCell>{log.actorEmail ?? log.actorId ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {actionLabel(log.action)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {log.targetType}:{log.targetId.slice(0, 12)}
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate font-mono text-xs">
                    {log.metadata ? JSON.stringify(log.metadata) : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("audit.total", { total })}</p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {t("audit.pageIndicator", {
              page,
              totalPages: Math.max(1, Math.ceil(total / LIMIT)),
            })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {t("audit.prev")}
            </Button>
            <Button
              variant="outline"
              disabled={page * LIMIT >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("audit.next")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
