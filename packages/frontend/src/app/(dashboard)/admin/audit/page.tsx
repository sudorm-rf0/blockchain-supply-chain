"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
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
  const [loading, setLoading] = useState(true);

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
    try {
      const data = await fetchAuditLogs({
        page,
        limit: LIMIT,
        targetType: targetType === "ALL" ? undefined : targetType,
      });
      setLogs(data.items);
      setTotal(data.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("audit.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, targetType, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{t("audit.title")}</h1>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t("refresh")}
          </Button>
        </div>
        <Select value={targetType} onValueChange={setTargetType}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("audit.filterAll")}</SelectItem>
            <SelectItem value="FILE">{t("audit.filterFile")}</SelectItem>
            <SelectItem value="TRADE">{t("audit.filterTrade")}</SelectItem>
            <SelectItem value="WITHDRAW">{t("audit.filterWithdraw")}</SelectItem>
          </SelectContent>
        </Select>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("audit.loading")}</p>
      ) : logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("audit.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
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
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("audit.total", { total })}</p>
        <div className="space-x-2">
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
  );
}