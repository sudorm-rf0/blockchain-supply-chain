"use client";

import { use, useCallback, useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
  getFiles,
  reviewFile,
  type FileRecord,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const LIMIT = 10;

function statusClass(status: FileRecord["status"]) {
  const map = {
    PENDING: "bg-yellow-200 text-yellow-800",
    APPROVED: "bg-green-200 text-green-800",
    REJECTED: "bg-red-200 text-red-800",
  } as const;
  return map[status];
}

export default function AdminFilesPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const resolvedParams = use(
    searchParams ?? Promise.resolve<{ status?: string }>({}),
  );
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState(resolvedParams.status ?? "PENDING");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getFiles({
        page,
        limit: LIMIT,
        status: status === "ALL" ? undefined : status,
      });
      setFiles(data.items);
      setTotal(data.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败");
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (id: string) => {
    setBusy(true);
    try {
      await reviewFile(id, { status: "APPROVED" });
      toast.success("审核通过");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const confirmApprove = async (id: string) => {
    setApproveId(null);
    await approve(id);
  };

  const reject = async () => {
    if (!rejectId) return;
    setBusy(true);
    try {
      await reviewFile(rejectId, { status: "REJECTED", remark: reason });
      toast.success("已驳回");
      setRejectId(null);
      setReason("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">全部文件</h1>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">待审核</SelectItem>
            <SelectItem value="APPROVED">已通过</SelectItem>
            <SelectItem value="REJECTED">已驳回</SelectItem>
            <SelectItem value="ALL">全部</SelectItem>
          </SelectContent>
        </Select>
      </div>

        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead>文件名</TableHead>
              <TableHead>上传者</TableHead>
              <TableHead>大小</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>哈希</TableHead>
              <TableHead>上传时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((file) => (
              <TableRow key={file.id}>
                <TableCell className="max-w-[180px] truncate">
                  {file.filename}
                </TableCell>
                <TableCell>{file.uploaderName ?? "-"}</TableCell>
                <TableCell>{(file.size / 1024).toFixed(0)} KB</TableCell>
                <TableCell>
                  <Badge className={statusClass(file.status)}>
                    {file.status}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {file.hash.slice(0, 8)}
                </TableCell>
                <TableCell>
                  {formatDateTime(file.createdAt)}
                </TableCell>
                <TableCell className="space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewId(file.id)}
                  >
                    <Eye className="mr-1 h-3 w-3" />
                    预览
                  </Button>
                  {file.status === "PENDING" && (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => setApproveId(file.id)}
                      >
                        通过
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => setRejectId(file.id)}
                      >
                        驳回
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

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

      <FilePreviewDialog
        open={previewId !== null}
        onOpenChange={(open) => !open && setPreviewId(null)}
        fileId={previewId}
      />

      <AlertDialog
        open={approveId !== null}
        onOpenChange={(open) => !open && setApproveId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认审核通过？</AlertDialogTitle>
            <AlertDialogDescription>
              通过后该文件状态将更新为 APPROVED，操作会写入审计日志。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setApproveId(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => approveId && void confirmApprove(approveId)}
            >
              确认通过
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={rejectId !== null} onOpenChange={(open) => !open && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>驳回文件</DialogTitle>
            <DialogDescription>请输入驳回理由</DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="驳回理由"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void reject()}
            >
              确认驳回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
