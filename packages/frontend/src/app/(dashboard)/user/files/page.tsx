"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Route, Eye, Trash2 } from "lucide-react";
import { toast } from "sonner";
import dynamic from "next/dynamic";
const FilePreviewDialog = dynamic(
  () =>
    import("@/components/FilePreviewDialog").then((m) => m.FilePreviewDialog),
  { ssr: false, loading: () => null },
);
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
import { solscanTxUrl } from "@/lib/solscan";
import { fileStatusClass } from "@/lib/status";

const LIMIT = 10;

export default function UserFilesPage() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<string>("ALL");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const fileStatusLabel = (status: string) =>
    t(`files.status.${status}`, { defaultValue: status });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFiles({
        page,
        limit: LIMIT,
        status: status === "ALL" ? undefined : status,
      });
      setFiles(data.items);
      setTotal(data.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("files.toasts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    if (!deleteId || deleting) return;
    setDeleting(true);
    try {
      await deleteFile(deleteId);
      toast.success(t("files.toasts.deleteSuccess"));
      setDeleteId(null);
      if (files.length === 1 && page > 1) {
        setPage((p) => p - 1);
      } else {
        await load();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("files.toasts.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const groups = files.reduce<Record<string, FileRecord[]>>((acc, file) => {
    const key =
      file.documentGroupId ?? file.tradeId ?? t("files.groupUnlinked");
    (acc[key] ??= []).push(file);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("files.title")}</h1>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("files.filterAll")}</SelectItem>
            <SelectItem value="PENDING">{t("files.status.PENDING")}</SelectItem>
            <SelectItem value="APPROVED">{t("files.status.APPROVED")}</SelectItem>
            <SelectItem value="REJECTED">{t("files.status.REJECTED")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="grid gap-4">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-md border bg-muted" />
            ))}
          </div>
        ) : Object.keys(groups).length === 0 ? (
          <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
            {t("files.empty")}
            {status !== "ALL" ? t("files.emptyFiltered") : ""}
          </div>
        ) : (
        Object.entries(groups).map(([group, groupFiles]) => (
          <div key={group}>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              {t("files.groupLabel", {
                group,
                count: groupFiles.length,
              })}
            </h2>
            <div className="overflow-x-auto rounded-md border">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("files.columns.filename")}</TableHead>
                    <TableHead>{t("files.columns.version")}</TableHead>
                    <TableHead>{t("files.columns.size")}</TableHead>
                    <TableHead>{t("files.columns.status")}</TableHead>
                    <TableHead>{t("files.columns.hash")}</TableHead>
                    <TableHead>{t("files.columns.uploadedAt")}</TableHead>
                    <TableHead>{t("files.columns.actions")}</TableHead>
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
                            {t("files.updated")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{(file.size / 1024).toFixed(0)} KB</TableCell>
                      <TableCell>
                        <Badge className={fileStatusClass(file.status)}>
                          {fileStatusLabel(file.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {file.hash.slice(0, 8)}
                      </TableCell>
                      <TableCell>{formatDateTime(file.createdAt)}</TableCell>
                      <TableCell className="flex flex-wrap gap-2">
                        {file.documentGroupId && (
                          <Button variant="outline" size="sm" asChild>
                            <Link
                              href={`/user/upload?documentId=${encodeURIComponent(
                                file.documentGroupId,
                              )}&tradeId=${encodeURIComponent(
                                file.tradeId ?? "",
                              )}`}
                            >
                              {t("files.uploadNewVersion")}
                            </Link>
                          </Button>
                        )}
                        {file.txSignature && (
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/trace/${file.id}`}>
                              <Route className="mr-1 h-3 w-3" />
                              {t("onchain.trace.entry")}
                            </Link>
                          </Button>
                        )}
                        {file.txSignature && (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={solscanTxUrl(file.txSignature)} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPreviewId(file.id)}
                        >
                          <Eye className="mr-1 h-3 w-3" />
                          {t("files.preview")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeleteId(file.id)}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          {t("files.delete")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ))
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("files.total", { count: total })}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("files.previous")}
          </Button>
          <Button
            variant="outline"
            disabled={page * LIMIT >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("files.next")}
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
            <AlertDialogTitle>{t("files.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("files.confirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("files.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? t("files.deleting") : t("files.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
