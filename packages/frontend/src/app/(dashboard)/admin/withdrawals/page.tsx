"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  executeWithdrawal,
  fetchWithdrawRequests,
  type WithdrawRequestRecord,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { WITHDRAW_STATUS_STYLE } from "@/lib/status";

export default function AdminWithdrawalsPage() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<WithdrawRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const statusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      PENDING: t("withdrawals.status.pending"),
      READY: t("withdrawals.status.ready"),
      EXECUTED: t("withdrawals.status.executed"),
    };
    return labels[status] ?? status;
  };

  const load = useCallback(async () => {
    try {
      setRequests(await fetchWithdrawRequests());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("withdrawals.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onExecute = async (id: string) => {
    // H-5：执行提款必须提供链上出金交易签名（管理员先在链上完成 USDC 转账）
    const sig = window.prompt(t("withdrawals.txSignaturePrompt"));
    if (!sig || !sig.trim()) return;
    setBusyId(id);
    try {
      const result = await executeWithdrawal(id, sig.trim());
      toast.success(
        t("withdrawals.statusToast", {
          status: statusLabel(result.status),
        }),
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("withdrawals.executeFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t("withdrawals.title")}</h1>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("withdrawals.loading")}</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("withdrawals.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("withdrawals.colLpWallet")}</TableHead>
                <TableHead>{t("withdrawals.colAmount")}</TableHead>
                <TableHead>{t("withdrawals.colRequestedAt")}</TableHead>
                <TableHead>{t("withdrawals.colAvailableAt")}</TableHead>
                <TableHead>{t("withdrawals.colStatus")}</TableHead>
                <TableHead>{t("withdrawals.colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="font-mono text-xs">
                    {request.lpAddress.slice(0, 16)}...
                  </TableCell>
                  <TableCell>{request.amount} USDC</TableCell>
                  <TableCell>{formatDateTime(request.requestedAt)}</TableCell>
                  <TableCell>{formatDateTime(request.availableAt)}</TableCell>
                  <TableCell>
                    <Badge className={WITHDRAW_STATUS_STYLE[request.status] ?? ""}>
                      {statusLabel(request.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {request.status === "READY" && (
                      <Button
                        size="sm"
                        disabled={busyId === request.id}
                        onClick={() => void onExecute(request.id)}
                      >
                        {t("withdrawals.execute")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
