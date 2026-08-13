"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { useDropzone } from "react-dropzone";
import { Camera } from "lucide-react";
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

function initialTradeId(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("tradeId") ?? "";
}

function initialDocumentId(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("documentId") ?? "";
}

export default function UploadPage() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [tradeId, setTradeId] = useState(initialTradeId);
  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [description, setDescription] = useState("");
  const [remark, setRemark] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [attesting, setAttesting] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [documentPda, setDocumentPda] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [attachedTradeId, setAttachedTradeId] = useState("");
  const { connection, connected, publicKey, sendTransaction } =
    useWalletContext();

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) {
      setFile(accepted[0]);
      setUploadedId(null);
      setHash(null);
      setVersion(null);
      setTxSignature(null);
      setDocumentPda(null);
      setAttachedTradeId("");
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(
        accepted[0].type.startsWith("image/")
          ? URL.createObjectURL(accepted[0])
          : null,
      );
    }
  }, [previewUrl]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxSize: MAX_SIZE,
    multiple: false,
  });

  const handleUpload = async () => {
    if (!file) {
      toast.error(t("upload.toasts.selectFile"));
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const result = await uploadFileWithProgress(
        file,
        { tradeId, documentId, description, remark },
        ({ percent }) => setProgress(percent),
      );
      toast.success(t("upload.toasts.uploadSuccess"));
      setUploadedId(result.id);
      setHash(result.hash);
      setVersion(result.version ?? null);
      setTxSignature(null);
      setDocumentPda(null);
      setFile(null);
      setTradeId("");
      setDocumentId("");
      setDescription("");
      setRemark("");
      setAttachedTradeId(tradeId.trim());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setProgress(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("upload.toasts.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const handleAttest = async () => {
    if (!uploadedId || !hash) {
      toast.error(t("upload.toasts.uploadFirst"));
      return;
    }
    if (!connected || !publicKey) {
      toast.error(t("upload.toasts.connectWallet"));
      return;
    }
    setAttesting(true);
    try {
      const built = await buildDocumentAttest(uploadedId, {
        walletAddress: publicKey.toBase58(),
        tradeId: attachedTradeId || tradeId || undefined,
      });
      const transaction = Transaction.from(
        Buffer.from(built.transaction, "base64"),
      );
      const signature = await sendTransaction(transaction, connection);
      await confirmTransactionWithTimeout(connection, signature, "confirmed");
      const result = await confirmDocumentAttest(uploadedId, {
        txSignature: signature,
        documentPda: built.documentPda,
        tradeId: attachedTradeId || tradeId || undefined,
      });
      setTxSignature(result.txSignature);
      setDocumentPda(result.documentPda);
      toast.success(t("upload.toasts.attestSuccess"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("upload.toasts.attestFailed"));
    } finally {
      setAttesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("upload.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {t("upload.attestHint")}
            </p>
            <WalletConnectButton />
          </div>

          <div
            {...getRootProps()}
            className={`cursor-pointer rounded-md border-2 border-dashed p-8 text-center transition-colors sm:p-12 ${
              isDragActive ? "border-primary bg-muted/40" : "border-muted"
            }`}
          >
            <input {...getInputProps()} />
            <p className="text-muted-foreground">{t("upload.dropzone")}</p>
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

          {file && (
            <div className="flex items-center gap-3">
              {previewUrl && (
                <Image
                  src={previewUrl}
                  alt={t("upload.previewAlt")}
                  width={64}
                  height={64}
                  unoptimized
                  className="h-16 w-16 rounded-md object-cover"
                />
              )}
              <p className="min-w-0 text-sm">
                {t("upload.fileInfo", {
                  name: file.name,
                  size: (file.size / 1024).toFixed(0),
                })}
              </p>
            </div>
          )}

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

          {uploading && progress !== null && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t("upload.uploading")}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <Button onClick={() => void handleUpload()} disabled={uploading}>
            {uploading ? t("upload.uploading") : t("upload.upload")}
          </Button>

          {hash && (
            <p className="break-all rounded-md bg-muted p-3 font-mono text-xs">
              {t("upload.fileHash", { hash })}
              {version ? t("upload.version", { version }) : ""}
            </p>
          )}

          {uploadedId && hash && (
            <div className="space-y-3">
              <Button
                onClick={() => void handleAttest()}
                disabled={attesting || !connected || !!txSignature}
              >
                {attesting
                  ? t("upload.attesting")
                  : txSignature
                    ? t("upload.attested")
                    : connected
                      ? t("upload.attest")
                      : t("upload.connectWallet")}
              </Button>
              {txSignature && (
                <p className="break-all rounded-md bg-muted p-3 font-mono text-xs">
                  {t("upload.txSignature", { signature: txSignature })}
                </p>
              )}
              {documentPda && (
                <p className="break-all rounded-md bg-muted p-3 font-mono text-xs">
                  {t("upload.documentPda", { account: documentPda })}
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {t("upload.supportedTypes")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
