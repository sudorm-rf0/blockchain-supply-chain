"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// 使用本地 worker（避免依赖 CDN，境内 VPS 可直接访问）
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface PdfPreviewProps {
  url: string; // blob URL
  fileName: string;
}

/**
 * 基于 pdf.js 的 PDF 预览：不依赖浏览器内置 PDF 查看器，
 * 支持分页；加载失败时提供「新窗口打开 / 下载」兜底。
 */
export function PdfPreview({ url, fileName }: PdfPreviewProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载 PDF 文档（仅一次）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    pdfjsLib
      .getDocument({ url })
      .promise.then((doc) => {
        if (cancelled) return;
        setPdfDoc(doc);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ? String(e.message) : "load failed");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // 渲染当前页
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const p = await pdfDoc.getPage(page);
        const viewport = p.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const renderParams: Parameters<typeof p.render>[0] = {
          canvas,
          viewport,
        };
        if (dpr !== 1) renderParams.transform = [dpr, 0, 0, dpr, 0, 0];
        await p.render(renderParams).promise;
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "render failed");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, page]);

  if (error) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-destructive">{t("files.previewPdfFailed")}</p>
        <div className="mt-4 flex justify-center gap-2">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
              <ExternalLink className="mr-1 h-3 w-3" />
              {t("files.openInNewTab")}
            </Button>
          </a>
          <a href={url} download={fileName}>
            <Button variant="outline" size="sm">
              <Download className="mr-1 h-3 w-3" />
              {t("files.download")}
            </Button>
          </a>
        </div>
      </div>
    );
  }

  if (!pdfDoc) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("files.loading")}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        className="max-w-full rounded-sm border border-border bg-white"
      />
      {loading && (
        <p className="py-3 text-xs text-muted-foreground">{t("files.loading")}</p>
      )}
      {pdfDoc.numPages > 1 && (
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="font-mono text-xs text-muted-foreground">
            {page} / {pdfDoc.numPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pdfDoc.numPages}
            onClick={() => setPage((p) => Math.min(pdfDoc.numPages, p + 1))}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
