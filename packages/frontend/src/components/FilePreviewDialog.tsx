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
