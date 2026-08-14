"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import dynamic from "next/dynamic";
const FilePreviewDialog = dynamic(
  () =>
    import("@/components/FilePreviewDialog").then((m) => m.FilePreviewDialog),
  { ssr: false, loading: () => null },
);
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
  analyzeFile,
  batchReviewFiles,
  getFiles,
  reviewFile,
  type FileRecord,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { regionLabel } from "@/lib/region";
import { fileStatusClass } from "@/lib/status";

const LIMIT = 10;

export default function AdminFilesPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const { t } = useTranslation();
  const statusLabel = (status: string) =>
    status === "APPROVED"
      ? t("files.statusApproved")
      : status === "REJECTED"
        ? t("files.statusRejected")
        : status === "PENDING"
          ? t("files.statusPending")
          : status;
  const resolvedParams = use(
    searchParams ?? Promise.resolve<{ status?: string }>({}),
  );
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState(resolvedParams.status ?? "PENDING");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchApproveOpen, setBatchApproveOpen] = useState(false);
  const [batchRejectOpen, setBatchRejectOpen] = useState(false);
  const [batchReason, setBatchReason] = useState("");
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
      toast.error(error instanceof Error ? error.message : t("files.loadFailed"));
    }
  }, [page, status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (id: string) => {
    setBusy(true);
    try {
      await reviewFile(id, { status: "APPROVED" });
      toast.success(t("files.approveSuccess"));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("files.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const confirmApprove = async (id: string) => {
    setApproveId(null);
    await approve(id);
  };

  const pendingIds = files
    .filter((file) => file.status === "PENDING")
    .map((file) => file.id);
  const allSelected =
    pendingIds.length > 0 &&
    pendingIds.every((id) => selectedIds.has(id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) pendingIds.forEach((id) => next.delete(id));
      else pendingIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const runBatch = async (status: "APPROVED" | "REJECTED", remark?: string) => {
    if (selectedIds.size === 0) return;
    setBusy(true);
    try {
      const result = await batchReviewFiles([...selectedIds], {
        status,
        remark,
      });
      toast.success(
        status === "APPROVED"
          ? t("files.batchApproveCompleted", {
              updated: result.updated,
              skipped: result.skipped,
            })
          : t("files.batchRejectCompleted", {
              updated: result.updated,
              skipped: result.skipped,
            }),
      );
      setSelectedIds(new Set());
      setBatchReason("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("files.batchActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejectId) return;
    setBusy(true);
    try {
      await reviewFile(rejectId, { status: "REJECTED", remark: reason });
      toast.success(t("files.rejectSuccess"));
      setRejectId(null);
      setReason("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("files.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleAnalyze = async (id: string) => {
    setAnalyzingId(id);
    try {
      const updated = await analyzeFile(id);
      toast.success(t("files.analyzeSuccess", { name: updated.filename }));
      setFiles((prev) => prev.map((f) => (f.id === id ? updated : f)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("files.actionFailed"));
    } finally {
      setAnalyzingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("files.title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground">
                {t("files.selectedCount", { n: selectedIds.size })}
              </span>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setBatchApproveOpen(true)}
              >
                {t("files.batchApprove")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => setBatchRejectOpen(true)}
              >
                {t("files.batchReject")}
              </Button>
            </>
          )}
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDING">{t("files.statusPending")}</SelectItem>
              <SelectItem value="APPROVED">{t("files.statusApproved")}</SelectItem>
              <SelectItem value="REJECTED">{t("files.statusRejected")}</SelectItem>
              <SelectItem value="ALL">{t("files.statusAll")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  aria-label={t("files.selectAllAriaLabel")}
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 accent-primary"
                />
              </TableHead>
              <TableHead>{t("files.name")}</TableHead>
              <TableHead>{t("files.uploader")}</TableHead>
              <TableHead>{t("files.region")}</TableHead>
              <TableHead>{t("files.size")}</TableHead>
              <TableHead>{t("files.status")}</TableHead>
              <TableHead>{t("files.hash")}</TableHead>
              <TableHead>{t("files.uploadTime")}</TableHead>
              <TableHead>{t("files.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((file) => (
              <TableRow key={file.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={t("files.selectFileAriaLabel", { name: file.filename })}
                    checked={selectedIds.has(file.id)}
                    disabled={file.status !== "PENDING"}
                    onChange={() => toggleSelect(file.id)}
                    className="h-4 w-4 accent-primary"
                  />
                </TableCell>
                <TableCell className="max-w-[180px] truncate">
                  {file.filename}
                </TableCell>
                <TableCell>{file.uploaderName ?? "-"}</TableCell>
                <TableCell className="font-mono text-xs">{regionLabel(file.region)}</TableCell>
                <TableCell>{(file.size / 1024).toFixed(0)} KB</TableCell>
                <TableCell>
                  <Badge className={fileStatusClass(file.status)}>
                    {statusLabel(file.status)}
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
                    {t("files.preview")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={analyzingId !== null}
                    onClick={() => void handleAnalyze(file.id)}
                  >
                    <RefreshCw className="mr-1 h-3 w-3" />
                    {t("files.reanalyze")}
                  </Button>
                  {file.status === "PENDING" && (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => setApproveId(file.id)}
                      >
                        {t("files.approve")}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => setRejectId(file.id)}
                      >
                        {t("files.reject")}
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
        <p className="text-sm text-muted-foreground">{t("files.totalCount", { n: total })}</p>
        <div className="space-x-2">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("files.previousPage")}
          </Button>
          <Button
            variant="outline"
            disabled={page * LIMIT >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("files.nextPage")}
          </Button>
        </div>
      </div>

      <FilePreviewDialog
        open={previewId !== null}
        onOpenChange={(open) => !open && setPreviewId(null)}
        fileId={previewId}
      />

      <AlertDialog
        open={batchApproveOpen}
        onOpenChange={(open) => !open && setBatchApproveOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("files.batchApproveConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("files.batchApproveConfirmDesc", { n: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setBatchApproveOpen(false)}>
              {t("files.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                setBatchApproveOpen(false);
                void runBatch("APPROVED");
              }}
            >
              {t("files.batchApproveConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={batchRejectOpen}
        onOpenChange={(open) => !open && setBatchRejectOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("files.batchRejectTitle")}</DialogTitle>
            <DialogDescription>
              {t("files.batchRejectDesc", { n: selectedIds.size })}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={batchReason}
            onChange={(e) => setBatchReason(e.target.value)}
            placeholder={t("files.rejectReasonPlaceholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchRejectOpen(false)}>
              {t("files.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !batchReason.trim()}
              onClick={() => {
                setBatchRejectOpen(false);
                void runBatch("REJECTED", batchReason.trim());
              }}
            >
              {t("files.batchRejectConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={approveId !== null}
        onOpenChange={(open) => !open && setApproveId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("files.approveConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("files.approveConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setApproveId(null)}>
              {t("files.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => approveId && void confirmApprove(approveId)}
            >
              {t("files.approveConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={rejectId !== null} onOpenChange={(open) => !open && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("files.rejectTitle")}</DialogTitle>
            <DialogDescription>{t("files.rejectDesc")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("files.rejectReasonPlaceholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>
              {t("files.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void reject()}
            >
              {t("files.rejectConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
