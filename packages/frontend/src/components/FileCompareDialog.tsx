"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { fetchFileBlob, type FileRecord } from "@/lib/api";
import { fileStatusClass } from "@/lib/status";
import { formatDateTime } from "@/lib/format";

interface FileCompareDialogProps {
  fileA: FileRecord | null;
  fileB: FileRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function PreviewPane({ file, url }: { file: FileRecord; url: string | null }) {
  const isImage = file.mimeType.startsWith("image/");
  const isPdf = file.mimeType === "application/pdf";
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium">{file.filename}</p>
        <Badge className={fileStatusClass(file.status)}>{file.status}</Badge>
      </div>
      <div className="flex h-72 items-center justify-center overflow-auto rounded-md border bg-muted/30 p-2">
        {isImage && url ? (
          <img src={url} alt={file.filename} className="max-h-full max-w-full object-contain" />
        ) : isPdf && url ? (
          <iframe src={url} title={file.filename} className="h-full w-full" />
        ) : (
          <p className="text-sm text-muted-foreground">该类型无法在线预览</p>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {formatDateTime(file.createdAt)} · {file.hash.slice(0, 12)}
      </p>
    </div>
  );
}

export function FileCompareDialog({
  fileA,
  fileB,
  open,
  onOpenChange,
}: FileCompareDialogProps) {
  const [urlA, setUrlA] = useState<string | null>(null);
  const [urlB, setUrlB] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !fileA || !fileB) return;
    let cancelled = false;
    let created: string[] = [];
    setUrlA(null);
    setUrlB(null);
    void (async () => {
      try {
        const [blobA, blobB] = await Promise.all([
          fetchFileBlob(fileA.id),
          fetchFileBlob(fileB.id),
        ]);
        if (cancelled) return;
        const a = URL.createObjectURL(blobA);
        const b = URL.createObjectURL(blobB);
        created = [a, b];
        setUrlA(a);
        setUrlB(b);
      } catch {
        // 加载失败时两个面板显示占位。
      }
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [open, fileA, fileB]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>文件对比</DialogTitle>
        </DialogHeader>
        {fileA && fileB ? (
          <div className="flex flex-col gap-4 sm:flex-row">
            <PreviewPane file={fileA} url={urlA} />
            <PreviewPane file={fileB} url={urlB} />
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            加载中...
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
