"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { useDropzone } from "react-dropzone";
import { Camera, CheckCircle2, Loader2, Trash2, XCircle } from "lucide-react";
import { Transaction } from "@solana/web3.js";
import { confirmTransactionWithTimeout } from "@/lib/solana";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWalletContext } from "@/hooks/useWalletContext";
import {
  buildDocumentAttest,
  confirmDocumentAttest,
  uploadFileWithProgress,
} from "@/lib/api";

const ACCEPT = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
};
const MAX_SIZE = 50 * 1024 * 1024;

interface UploadItem {
  localId: string;
  file: File;
  previewUrl?: string;
  status: "pending" | "uploading" | "success" | "error";
  progress?: number;
  uploadedId?: string;
  hash?: string;
  version?: number;
  error?: string;
  txSignature?: string;
  documentPda?: string;
  attesting?: boolean;
}

let localSeq = 0;
function nextLocalId(): string {
  localSeq += 1;
  return `${Date.now().toString(36)}-${localSeq}`;
}

function initialTradeId(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("tradeId") ?? "";
}

function initialDocumentId(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("documentId") ?? "";
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export default function UploadPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [tradeId, setTradeId] = useState(initialTradeId);
  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [description, setDescription] = useState("");
  const [remark, setRemark] = useState("");
  const [uploading, setUploading] = useState(false);
  const [attachedTradeId, setAttachedTradeId] = useState("");
  const { connection, connected, publicKey, sendTransaction } =
    useWalletContext();

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length === 0) return;
    const next: UploadItem[] = accepted.map((f) => ({
      localId: nextLocalId(),
      file: f,
      previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
      status: "pending",
    }));
    setItems((prev) => [...prev, ...next]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxSize: MAX_SIZE,
    multiple: true,
  });

  const pendingCount = items.filter(
    (i) => i.status === "pending" || i.status === "error",
  ).length;
  const successCount = items.filter((i) => i.status === "success").length;
  const failCount = items.filter((i) => i.status === "error").length;

  const patchItem = (localId: string, patch: Partial<UploadItem>) => {
    setItems((prev) =>
      prev.map((i) => (i.localId === localId ? { ...i, ...patch } : i)),
    );
  };

  const handleUploadAll = async () => {
    const targets = items.filter(
      (i) => i.status === "pending" || i.status === "error",
    );
    if (targets.length === 0) {
      toast.error(t("upload.toasts.selectFile"));
      return;
    }
    setUploading(true);
    let failed = 0;
    for (const target of targets) {
      patchItem(target.localId, { status: "uploading", progress: 0, error: undefined });
      try {
        const result = await uploadFileWithProgress(
          target.file,
          { tradeId, documentId, description, remark },
          ({ percent }) => patchItem(target.localId, { progress: percent }),
        );
        patchItem(target.localId, {
          status: "success",
          progress: 100,
          uploadedId: result.id,
          hash: result.hash,
          version: result.version ?? undefined,
        });
      } catch (error) {
        failed += 1;
        patchItem(target.localId, {
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : t("upload.toasts.uploadFailed"),
        });
      }
    }
    setUploading(false);
    setAttachedTradeId(tradeId.trim());
    if (failed === 0) {
      toast.success(t("upload.toasts.uploadSuccess"));
    } else {
      toast.error(
        t("upload.failedCount", { count: failed }),
      );
    }
  };

  const handleAttest = async (item: UploadItem) => {
    if (!item.uploadedId || !item.hash) {
      toast.error(t("upload.toasts.uploadFirst"));
      return;
    }
    if (!connected || !publicKey) {
      toast.error(t("upload.toasts.connectWallet"));
      return;
    }
    patchItem(item.localId, { attesting: true });
    try {
      const built = await buildDocumentAttest(item.uploadedId, {
        walletAddress: publicKey.toBase58(),
        tradeId: attachedTradeId || tradeId || undefined,
      });
      const transaction = Transaction.from(
        Buffer.from(built.transaction, "base64"),
      );
      const signature = await sendTransaction(transaction, connection);
      await confirmTransactionWithTimeout(connection, signature, "confirmed");
      const result = await confirmDocumentAttest(item.uploadedId, {
        txSignature: signature,
        documentPda: built.documentPda,
        tradeId: attachedTradeId || tradeId || undefined,
      });
      patchItem(item.localId, {
        attesting: false,
        txSignature: result.txSignature ?? undefined,
        documentPda: result.documentPda ?? undefined,
      });
      toast.success(t("upload.toasts.attestSuccess"));
    } catch (error) {
      patchItem(item.localId, { attesting: false });
      toast.error(
        error instanceof Error
          ? error.message
          : t("upload.toasts.attestFailed"),
      );
    }
  };

  const handleRemove = (localId: string) => {
    setItems((prev) => {
      const target = prev.find((i) => i.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.localId !== localId);
    });
  };

  const handleClearFinished = () => {
    setItems((prev) => {
      prev.forEach((i) => {
        if (i.status === "success" || i.status === "error") {
          if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
        }
      });
      return prev.filter((i) => i.status === "pending" || i.status === "uploading");
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("upload.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground">
              {t("upload.attestHint")}
            </p>
            <WalletConnectButton />
          </div>

          <div
            {...getRootProps()}
            className={`flex min-h-[190px] cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-6 text-center transition-colors sm:p-10 ${
              isDragActive
                ? "border-[#00E676] bg-[#00E676]/5"
                : failCount > 0
                  ? "border-red-500/60 bg-red-500/5"
                  : successCount > 0
                    ? "border-[#00E676] bg-[#00E676]/5"
                    : "border-[#00E676]/50 hover:border-[#00E676]"
            }`}
          >
            <input {...getInputProps()} />
            {successCount > 0 && failCount === 0 ? (
              <div className="space-y-2">
                <p className="font-mono text-base font-bold text-[#00E676]">
                  ✓ {t("upload.successCount", { count: successCount })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("upload.successPreviewHint")}
                </p>
              </div>
            ) : failCount > 0 ? (
              <div className="space-y-2">
                <p className="font-mono text-base font-bold text-red-500">
                  ✗ {t("upload.failedCount", { count: failCount })}
                </p>
                {successCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("upload.successCount", { count: successCount })}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {t("upload.retryHint")}
                </p>
              </div>
            ) : items.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-bold text-foreground">
                  {t("upload.selectedCount", { count: items.length })}
                </p>
                <p className="text-xs font-medium text-[#00E676]">
                  {t("upload.selectedPreviewHint")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-muted-foreground">{t("upload.dropzone")}</p>
                <p className="text-xs text-muted-foreground/70">
                  {t("upload.multiHint")}
                </p>
              </div>
            )}
          </div>

          <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/50 sm:w-auto">
            <Camera className="h-4 w-4" />
            {t("upload.camera")}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) onDrop([picked]);
                e.target.value = "";
              }}
            />
          </label>

          <div className="space-y-2">
            <Label htmlFor="tradeId">{t("upload.tradeIdLabel")}</Label>
            <Input
              id="tradeId"
              value={tradeId}
              onChange={(e) => setTradeId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="documentId">{t("upload.documentIdLabel")}</Label>
            <Input
              id="documentId"
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              placeholder={t("upload.documentIdPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">{t("upload.descriptionLabel")}</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="remark">{t("upload.remarkLabel")}</Label>
            <Textarea
              id="remark"
              value={remark}
              maxLength={500}
              placeholder={t("upload.remarkPlaceholder")}
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => void handleUploadAll()}
              disabled={uploading || pendingCount === 0}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("upload.uploading")}
                </>
              ) : (
                t("upload.uploadAll", { count: pendingCount })
              )}
            </Button>
            {items.some((i) => i.status === "success" || i.status === "error") && (
              <Button variant="outline" onClick={handleClearFinished}>
                <Trash2 className="mr-2 h-4 w-4" />
                {t("upload.clearList")}
              </Button>
            )}
          </div>

          {items.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">{t("upload.listTitle")}</p>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {items.map((item) => (
                  <div
                    key={item.localId}
                    className="rounded-md border bg-muted/30 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        {item.previewUrl && (
                          <Image
                            src={item.previewUrl}
                            alt={t("upload.previewAlt")}
                            width={48}
                            height={48}
                            unoptimized
                            className="h-12 w-12 shrink-0 rounded-md object-cover"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-foreground">
                            {item.file.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatSize(item.file.size)}
                          </p>
                          {item.status === "uploading" && item.progress != null && (
                            <div className="mt-1 flex items-center gap-2">
                              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-[#00E676] transition-all"
                                  style={{ width: `${item.progress}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {item.progress}%
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={t("upload.removeItem")}
                        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => handleRemove(item.localId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {item.status === "success" && (
                      <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
                        <p className="flex items-start gap-1.5 text-xs">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#00E676]" />
                          <span className="break-all font-mono text-foreground">
                            {t("upload.fileHash", { hash: item.hash ?? "" })}
                            {item.version
                              ? t("upload.version", { version: item.version })
                              : ""}
                          </span>
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleAttest(item)}
                            disabled={
                              item.attesting ||
                              !connected ||
                              !!item.txSignature
                            }
                          >
                            {item.attesting ? (
                              <>
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                {t("upload.attesting")}
                              </>
                            ) : item.txSignature ? (
                              t("upload.attested")
                            ) : connected ? (
                              t("upload.attest")
                            ) : (
                              t("upload.connectWallet")
                            )}
                          </Button>
                        </div>
                        {item.txSignature && (
                          <p className="break-all font-mono text-xs text-muted-foreground">
                            {t("upload.txSignature", {
                              signature: item.txSignature,
                            })}
                          </p>
                        )}
                        {item.documentPda && (
                          <p className="break-all font-mono text-xs text-muted-foreground">
                            {t("upload.documentPda", {
                              account: item.documentPda,
                            })}
                          </p>
                        )}
                      </div>
                    )}

                    {item.status === "error" && (
                      <div className="mt-2 flex items-start gap-1.5 border-t border-border/60 pt-2">
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                        <p className="text-xs text-red-500">
                          {t("upload.inlineFailed")}：{item.error}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
