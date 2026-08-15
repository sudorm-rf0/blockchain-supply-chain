"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink, FileWarning } from "lucide-react";
import { getFile, fetchFileBlob, type FileRecord } from "@/lib/api";
import { PdfPreview } from "@/components/PdfPreview";
import { Button } from "@/components/ui/button";

/** 独立预览页：在新标签页打开文件（PDF 用 pdf.js 渲染，图片直接显示） */
export default function PreviewPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [file, setFile] = useState<FileRecord | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setError(null);
    void (async () => {
      try {
        const [meta, blob] = await Promise.all([getFile(id), fetchFileBlob(id)]);
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setFile(meta);
        setBlobUrl(createdUrl);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [id]);

  const isImage = file?.mimeType.startsWith("image/") ?? false;
  const isPdf = file?.mimeType === "application/pdf";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm">{file?.filename ?? t("preview.title")}</p>
          <p className="text-xs text-muted-foreground">
            {file ? `${(file.size / 1024).toFixed(0)} KB · ${file.hash.slice(0, 16)}…` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {blobUrl && (
            <>
              <a href={blobUrl} download={file?.filename} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <Download className="mr-1 h-3 w-3" />
                  {t("files.download")}
                </Button>
              </a>
              <a href={`/api/files/${id}/content`} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <ExternalLink className="mr-1 h-3 w-3" />
                  {t("preview.openOriginal")}
                </Button>
              </a>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col items-center p-6">
        {error && (
          <div className="mt-20 flex flex-col items-center gap-3 text-center">
            <FileWarning className="h-12 w-12 text-amber-500" />
            <p className="text-muted-foreground">
              {t("preview.loadFailed")} — {error}
            </p>
            <Link href="/login">
              <Button variant="outline">{t("preview.goLogin")}</Button>
            </Link>
          </div>
        )}

        {!file && !error && (
          <p className="mt-20 text-sm text-muted-foreground">{t("loading")}</p>
        )}

        {file && isPdf && blobUrl && (
          <PdfPreview url={blobUrl} fileName={file.filename} maxHeight={720} />
        )}

        {file && isImage && blobUrl && (
          <div className="w-full overflow-auto rounded border">
            <Image
              src={blobUrl}
              alt={file.filename}
              width={1600}
              height={1200}
              unoptimized
              className="mx-auto h-auto max-h-[78vh] w-auto object-contain"
            />
          </div>
        )}

        {file && !isPdf && !isImage && (
          <p className="mt-20 text-sm text-muted-foreground">{t("preview.unsupported")}</p>
        )}
      </main>
    </div>
  );
}
