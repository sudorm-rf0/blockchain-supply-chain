"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Image from "next/image";
import { Copy, Check, Download } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileCompareDialog } from "@/components/FileCompareDialog";
import {
  fetchFileBlob,
  fetchFileVersions,
  getFile,
  type FileRecord,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { regionLabel } from "@/lib/region";
import { ShieldCheck, ScanText, FileText } from "lucide-react";

interface FilePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: string | null;
}

function statusBadge(status: FileRecord["status"]) {
  const map = {
    PENDING: "bg-yellow-200 text-yellow-800",
    APPROVED: "bg-green-200 text-green-800",
    REJECTED: "bg-red-200 text-red-800",
  } as const;
  return map[status];
}

export function FilePreviewDialog({
  open,
  onOpenChange,
  fileId,
}: FilePreviewDialogProps) {
  const { t } = useTranslation();
  const statusLabel = (status: FileRecord["status"]) =>
    status === "APPROVED"
      ? t("files.statusApproved")
      : status === "REJECTED"
        ? t("files.statusRejected")
        : status === "PENDING"
          ? t("files.statusPending")
          : status;
  const [file, setFile] = useState<FileRecord | null>(null);
  const [versions, setVersions] = useState<FileRecord[]>([]);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [comparePair, setComparePair] = useState<{
    a: FileRecord;
    b: FileRecord;
  } | null>(null);

  useEffect(() => {
    if (!open || !fileId) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setObjectUrl(null);
    void (async () => {
      try {
        const [meta, blob, versionList] = await Promise.all([
          getFile(fileId),
          fetchFileBlob(fileId),
          fetchFileVersions(fileId),
        ]);
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setFile(meta);
        setVersions(versionList);
        setObjectUrl(createdUrl);
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : t("files.previewLoadFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, fileId, t]);

  const copyHash = async () => {
    if (!file) return;
    await navigator.clipboard.writeText(file.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isImage = file?.mimeType.startsWith("image/") ?? false;
  const isPdf = file?.mimeType === "application/pdf";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("files.previewTitle")}</DialogTitle>
        </DialogHeader>
        {file ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">{t("files.name")}</p>
                <p className="break-all">{file.filename}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("files.size")}</p>
                <p>{(file.size / 1024).toFixed(0)} KB</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("files.mimeType")}</p>
                <p>{file.mimeType}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("files.uploadTime")}</p>
                <p>{formatDateTime(file.createdAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("files.region")}</p>
                <p>{regionLabel(file.region)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("files.status")}</p>
                <Badge className={statusBadge(file.status)}>{statusLabel(file.status)}</Badge>
              </div>
              <div>
                <p className="text-muted-foreground">{t("files.version")}</p>
                <p>
                  v{file.version ?? 1}
                  {file.isLatest === false ? t("files.versionUpdated") : t("files.versionLatest")}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("files.hash")}</p>
                <button
                  type="button"
                  onClick={() => void copyHash()}
                  className="flex items-center gap-1 font-mono text-xs hover:underline"
                >
                  {file.hash.slice(0, 16)}...
                  {copied ? (
                    <Check className="h-3 w-3 text-green-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>

            {file.remark && (
              <div>
                <p className="text-muted-foreground">{t("files.remark")}</p>
                <p className="text-sm">{file.remark}</p>
              </div>
            )}

            <div className="rounded-md border">
              <div className="flex items-center gap-2 border-b p-3">
                <ScanText className="h-4 w-4 text-[#00E676]" />
                <p className="font-mono text-sm font-semibold">{t("files.ocr")}</p>
                <span className="ml-auto text-xs text-muted-foreground">
                  {file.ocrStatus === "SUCCESS"
                    ? t("files.ocrDone")
                    : file.ocrStatus === "PROCESSING"
                      ? t("files.ocrProcessing")
                      : file.ocrStatus === "FAILED"
                        ? t("files.ocrFailed")
                        : t("files.ocrNotStarted")}
                </span>
              </div>
              <div className="max-h-48 overflow-auto p-3">
                {file.ocrText ? (
                  <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
                    {file.ocrText}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("files.ocrEmpty")}</p>
                )}
              </div>
            </div>

            {file.authResult?.keyFields &&
              Object.values(file.authResult.keyFields).some((f) => f?.value) && (
                <div className="rounded-md border">
                  <div className="flex items-center gap-2 border-b p-3">
                    <FileText className="h-4 w-4 text-[#00E676]" />
                    <p className="font-mono text-sm font-semibold">{t("files.keyFields")}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 p-3 text-sm">
                    {file.authResult.keyFields.invoiceNumber?.value && (
                      <div>
                        <span className="text-muted-foreground">{t("files.invoiceNumber")}：</span>
                        <span className="font-mono">{file.authResult.keyFields.invoiceNumber.value}</span>
                      </div>
                    )}
                    {file.authResult.keyFields.amount?.value && (
                      <div>
                        <span className="text-muted-foreground">{t("files.amount")}：</span>
                        <span className="font-mono">
                          {file.authResult.keyFields.amount.value}
                          {file.authResult.keyFields.amount.numeric ? ` = ¥${file.authResult.keyFields.amount.numeric}` : ""}
                        </span>
                      </div>
                    )}
                    {file.authResult.keyFields.date?.value && (
                      <div>
                        <span className="text-muted-foreground">{t("files.date")}：</span>
                        <span className="font-mono">{file.authResult.keyFields.date.value}</span>
                      </div>
                    )}
                    {file.authResult.keyFields.contractNo?.value && (
                      <div>
                        <span className="text-muted-foreground">{t("files.contractNo")}：</span>
                        <span className="font-mono">{file.authResult.keyFields.contractNo.value}</span>
                      </div>
                    )}
                    {file.authResult.keyFields.seller?.value && (
                      <div>
                        <span className="text-muted-foreground">{t("files.seller")}：</span>
                        <span>{file.authResult.keyFields.seller.value}</span>
                      </div>
                    )}
                    {file.authResult.keyFields.buyer?.value && (
                      <div>
                        <span className="text-muted-foreground">{t("files.buyer")}：</span>
                        <span>{file.authResult.keyFields.buyer.value}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

            <div className="rounded-md border">
              <div className="flex items-center gap-2 border-b p-3">
                <ShieldCheck className="h-4 w-4 text-[#00E676]" />
                <p className="font-mono text-sm font-semibold">{t("files.authenticity")}</p>
                {file.authStatus === "SUCCESS" && file.authScore != null ? (
                  <span
                    className={`ml-auto rounded px-2 py-0.5 font-mono text-xs ${
                      file.authScore >= 80
                        ? "border border-[#00E676]/40 bg-[#00E676]/10 text-[#00E676]"
                        : file.authScore >= 55
                          ? "border border-amber-500/40 bg-amber-500/10 text-amber-500"
                          : "border border-red-500/40 bg-red-500/10 text-red-500"
                    }`}
                  >
                    {file.authScore} ·{" "}
                    {file.authScore >= 80
                      ? t("files.authLowRisk")
                      : file.authScore >= 55
                        ? t("files.authMediumRisk")
                        : t("files.authHighRisk")}
                  </span>
                ) : (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {file.authStatus === "PROCESSING"
                      ? t("files.authProcessing")
                      : file.authStatus === "FAILED"
                        ? t("files.authFailed")
                        : t("files.authNotStarted")}
                  </span>
                )}
              </div>
              {file.authResult?.checks && file.authResult.checks.length > 0 ? (
                <ul className="space-y-1 p-3">
                  {file.authResult.checks.map((c) => (
                    <li
                      key={c.name}
                      className="flex items-start gap-2 text-sm"
                    >
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 ${
                          c.passed ? "bg-[#00E676]" : "bg-red-500"
                        }`}
                      />
                      <span className="flex-1 text-muted-foreground">{c.detail}</span>
                      <span
                        className={`font-mono text-xs ${
                          c.passed ? "text-[#00E676]" : "text-red-500"
                        }`}
                      >
                        {c.passed ? t("files.checkPassed") : t("files.checkFailed")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-3 text-sm text-muted-foreground">{t("files.noAnalysis")}</p>
              )}
              {file.authResult?.validations && file.authResult.validations.length > 0 && (
                <div className="border-t p-3">
                  <p className="mb-2 font-mono text-xs font-semibold text-muted-foreground">
                    {t("files.validations")}
                  </p>
                  <ul className="space-y-1">
                    {file.authResult.validations.map((v) => (
                      <li key={v.name} className="flex items-start gap-2 text-sm">
                        <span className={`mt-1 h-2 w-2 shrink-0 ${v.passed ? "bg-[#00E676]" : "bg-amber-500"}`} />
                        <span className="flex-1 text-muted-foreground">{v.detail}</span>
                        <span className={`font-mono text-xs ${v.passed ? "text-[#00E676]" : "text-amber-500"}`}>
                          {v.passed ? t("files.checkPassed") : t("files.checkFailed")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {versions.length > 1 && (
              <div>
                <p className="mb-2 text-muted-foreground">{t("files.versionHistory")}</p>
                <div className="space-y-2">
                  {versions.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between gap-2 rounded-md border p-2 text-sm ${
                        item.id === file.id ? "border-primary/50 bg-muted/40" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs">
                          v{item.version ?? 1} · {item.filename}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(item.createdAt)} · {item.hash.slice(0, 8)}
                        </p>
                      </div>
                      <Badge className={statusBadge(item.status)}>
                        {statusLabel(item.status)}
                      </Badge>
                      {item.id !== file.id && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setComparePair({ a: file, b: item })}
                        >
                          {t("files.compare")}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="relative h-96 rounded-md border bg-muted/30 p-3">
              {isImage ? (
                <Image
                  src={objectUrl ?? ""}
                  alt={file.filename}
                  fill
                  unoptimized
                  className="object-contain"
                />
              ) : isPdf ? (
                <iframe
                  src={objectUrl ?? ""}
                  title={file.filename}
                  className="h-96 w-full"
                />
              ) : (
                <div className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t("files.previewUnavailable")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    {t("files.previewDownloadHint")}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <a href={objectUrl ?? ""} download={file.filename}>
                <Button type="button" variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  {t("files.download")}
                </Button>
              </a>
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("files.loading")}
          </p>
        )}
        </DialogContent>
      </Dialog>
      <FileCompareDialog
        open={comparePair !== null}
        onOpenChange={(open) => !open && setComparePair(null)}
        fileA={comparePair?.a ?? null}
        fileB={comparePair?.b ?? null}
      />
    </>
  );
}
