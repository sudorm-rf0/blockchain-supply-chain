"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
const ACTION_LABEL: Record<string, string> = {
  FILE_APPROVED: "文件通过",
  FILE_REJECTED: "文件驳回",
  FILE_DELETED: "文件删除",
  TRADE_CREATED: "订单创建",
  TRADE_FUNDED: "订单拨款",
  TRADE_ADVANCED: "状态推进",
  TRADE_REPAID: "订单还款",
  TRADE_DEFAULTED: "订单违约",
  WITHDRAW_REQUESTED: "提款申请",
  WITHDRAW_EXECUTED: "提款执行",
};

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [targetType, setTargetType] = useState("ALL");
  const [loading, setLoading] = useState(true);

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
      toast.error(error instanceof Error ? error.message : "加载审计日志失败");
    } finally {
      setLoading(false);
    }
  }, [page, targetType]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">审计日志</h1>
        <Select value={targetType} onValueChange={setTargetType}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部</SelectItem>
            <SelectItem value="FILE">文件</SelectItem>
            <SelectItem value="TRADE">订单</SelectItem>
            <SelectItem value="WITHDRAW">提款</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无审计记录</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>操作人</TableHead>
                <TableHead>动作</TableHead>
                <TableHead>对象</TableHead>
                <TableHead>详情</TableHead>
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
                      {ACTION_LABEL[log.action] ?? log.action}
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
        <p className="text-sm text-muted-foreground">共 {total} 条</p>
        <div className="space-x-2">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            disabled={page * LIMIT >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}
