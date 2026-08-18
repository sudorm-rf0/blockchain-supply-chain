"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Bot, ExternalLink, Eye, RefreshCw, Route } from "lucide-react";
import { toast } from "sonner";
import dynamic from "next/dynamic";
const AiAssistantDialog = dynamic(
  () => import("@/components/AiAssistantDialog").then((m) => m.AiAssistantDialog),
  { ssr: false },
);

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
  aiReviewFile,
  analyzeFile,
  batchReviewFiles,
  getFile,
  getFiles,
  reviewFile,
  type AiReviewReport,
  type FileRecord,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { solscanTxUrl } from "@/lib/solscan";
import { regionLabel } from "@/lib/region";
import { fileStatusClass } from "@/lib/status";

const LIMIT = 10;

const RISK_STYLE: Record<string, string> = {
  LOW: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  MEDIUM: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  HIGH: "bg-red-500/10 text-red-600 border-red-500/30",
};

export default function AdminFilesPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
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
  const urlStatus = resolvedParams.status ?? "PENDING";
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState(resolvedParams.status ?? "PENDING");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [aiFile, setAiFile] = useState<FileRecord | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchApproveOpen, setBatchApproveOpen] = useState(false);
  const [batchRejectOpen, setBatchRejectOpen] = useState(false);
  const [batchReason, setBatchReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [batchAiOpen, setBatchAiOpen] = useState(false);
  const [batchAiRunning, setBatchAiRunning] = useState(false);
  const [batchAiResults, setBatchAiResults] = useState<
    Array<{
      filename: string;
      riskLevel: string;
      summary: string;
      error?: string;
    }>
  >([]);

  // 跟随 URL 的 status 参数：点击侧边栏「文件审核/全部文件」时，列表内容与高亮同步切换。
  useEffect(() => {
    setStatus(urlStatus);
    setPage(1);
  }, [urlStatus]);

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

  // 审计中危-8：翻页/切换状态筛选时清空已选，防止对不可见文件执行批量操作。
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, status]);

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

  const runBatchAi = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBatchAiRunning(true);
    setBatchAiResults([]);
    setBatchAiOpen(true);
    try {
      const results: Array<{
        filename: string;
        riskLevel: string;
        summary: string;
        error?: string;
      }> = [];
      for (const id of ids) {
        const file = files.find((f) => f.id === id);
        try {
          const report: AiReviewReport = await aiReviewFile(id);
          results.push({
            filename: file?.filename ?? id,
            riskLevel: report.riskLevel,
            summary: report.summary,
          });
        } catch (error) {
          results.push({
            filename: file?.filename ?? id,
            riskLevel: "ERROR",
            summary: "",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      setBatchAiResults(results);
    } finally {
      setBatchAiRunning(false);
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
      // 后端 /analyze 返回分析结果（AnalysisResult），并非完整 FileRecord；
      // 先触发分析，再拉取最新文件记录用于更新列表与提示。
      await analyzeFile(id);
      const updated = await getFile(id);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
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
              <Button
                size="sm"
                variant="outline"
                disabled={busy || batchAiRunning}
                onClick={() => void runBatchAi()}
              >
                <Bot className="mr-1.5 h-3.5 w-3.5" />
                {batchAiRunning ? t("files.batchAiRunning") : t("files.batchAi")}
              </Button>
            </>
          )}
          <Select
            value={status}
            onValueChange={(value) => {
              const params = new URLSearchParams(window.location.search);
              params.set("status", value);
              router.replace(`/admin/files?${params.toString()}`, {
                scroll: false,
              });
            }}
          >
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
                <TableCell className="flex flex-wrap gap-2">
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
                    onClick={() => setAiFile(file)}
                  >
                    <Bot className="mr-1 h-3 w-3" />
                    {t("files.ai.button")}
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
        <div className="flex items-center gap-2">
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

      <Dialog open={batchAiOpen} onOpenChange={setBatchAiOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("files.batchAiTitle", { n: selectedIds.size })}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {batchAiRunning && batchAiResults.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("files.batchAiRunning")}</p>
            )}
            {batchAiResults.map((r, i) => (
              <div key={i} className="rounded-md border p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{r.filename}</span>
                  {r.error ? (
                    <span className="shrink-0 text-xs text-red-600">{r.error}</span>
                  ) : (
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${
                        RISK_STYLE[r.riskLevel] ?? ""
                      }`}
                    >
                      {t(`files.ai.risk.${r.riskLevel}`, { defaultValue: r.riskLevel })}
                    </span>
                  )}
                </div>
                {r.summary && <p className="mt-1 text-muted-foreground">{r.summary}</p>}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {aiFile && (
        <AiAssistantDialog
          file={aiFile}
          open
          onOpenChange={(open) => !open && setAiFile(null)}
        />
      )}

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
