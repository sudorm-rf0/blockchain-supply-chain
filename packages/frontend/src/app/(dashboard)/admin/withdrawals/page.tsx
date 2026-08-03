"use client";

import { useCallback, useEffect, useState } from "react";
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
  const [requests, setRequests] = useState<WithdrawRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests(await fetchWithdrawRequests());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载提款失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onExecute = async (id: string) => {
    setBusyId(id);
    try {
      const result = await executeWithdrawal(id);
      toast.success(`提款状态：${result.status}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "执行失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">提款管理</h1>
      {loading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无提款请求</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead>LP 钱包</TableHead>
                <TableHead>金额</TableHead>
                <TableHead>申请时间</TableHead>
                <TableHead>可用时间</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
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
                      {request.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {request.status === "READY" && (
                      <Button
                        size="sm"
                        disabled={busyId === request.id}
                        onClick={() => void onExecute(request.id)}
                      >
                        执行
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
