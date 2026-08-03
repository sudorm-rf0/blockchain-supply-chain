"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Eye, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
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
import { deleteFile, getFiles, type FileRecord } from "@/lib/api";
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

export default function UserFilesPage() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<string>("ALL");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

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

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteFile(deleteId);
      toast.success("删除成功");
      setDeleteId(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const groups = files.reduce<Record<string, FileRecord[]>>((acc, file) => {
    const key = file.documentGroupId ?? file.tradeId ?? "未关联";
    (acc[key] ??= []).push(file);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">我的文件</h1>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部</SelectItem>
            <SelectItem value="PENDING">待审核</SelectItem>
            <SelectItem value="APPROVED">已通过</SelectItem>
            <SelectItem value="REJECTED">已驳回</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        {Object.entries(groups).map(([group, groupFiles]) => (
          <div key={group}>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              单据组：{group}（{groupFiles.length}）
            </h2>
            <div className="overflow-x-auto rounded-md border">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>文件名</TableHead>
                    <TableHead>版本</TableHead>
                    <TableHead>大小</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>哈希</TableHead>
                    <TableHead>上传时间</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupFiles.map((file) => (
                    <TableRow key={file.id}>
                      <TableCell className="max-w-[200px] truncate">
                        {file.filename}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">v{file.version ?? 1}</span>
                        {file.isLatest === false && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            （已更新）
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{(file.size / 1024).toFixed(0)} KB</TableCell>
                      <TableCell>
                        <Badge className={statusClass(file.status)}>
                          {file.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {file.hash.slice(0, 8)}
                      </TableCell>
                      <TableCell>{formatDateTime(file.createdAt)}</TableCell>
                      <TableCell className="space-x-2">
                        {file.documentGroupId && (
                          <Button variant="outline" size="sm" asChild>
                            <Link
                              href={`/user/upload?documentId=${encodeURIComponent(
                                file.documentGroupId,
                              )}&tradeId=${encodeURIComponent(
                                file.tradeId ?? "",
                              )}`}
                            >
                              上传新版
                            </Link>
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPreviewId(file.id)}
                        >
                          <Eye className="mr-1 h-3 w-3" />
                          预览
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeleteId(file.id)}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          删除
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}
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

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法恢复，确定要删除该文件吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
