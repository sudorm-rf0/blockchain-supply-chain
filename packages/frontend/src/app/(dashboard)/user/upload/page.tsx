"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Camera, FileUp } from "lucide-react";
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
  uploadFile,
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
  const [file, setFile] = useState<File | null>(null);
  const [tradeId, setTradeId] = useState(initialTradeId);
  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [attesting, setAttesting] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [documentPda, setDocumentPda] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { connection, connected, publicKey, sendTransaction } =
    useWalletContext();

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) {
      setFile(accepted[0]);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(
        accepted[0].type.startsWith("image/")
          ? URL.createObjectURL(accepted[0])
          : null,
      );
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxSize: MAX_SIZE,
    multiple: false,
  });

  const handleUpload = async () => {
    if (!file) {
      toast.error("请先选择文件");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (tradeId) formData.append("tradeId", tradeId);
      if (documentId) formData.append("documentId", documentId);
      if (description) formData.append("description", description);
      const result = await uploadFile(formData);
      toast.success("上传成功");
      setUploadedId(result.id);
      setHash(result.hash);
      setVersion(result.version ?? null);
      setTxSignature(null);
      setDocumentPda(null);
      setFile(null);
      setTradeId("");
      setDocumentId("");
      setDescription("");
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const handleAttest = async () => {
    if (!uploadedId || !hash) {
      toast.error("请先上传文件");
      return;
    }
    if (!connected || !publicKey) {
      toast.error("请先连接钱包");
      return;
    }
    setAttesting(true);
    try {
      const built = await buildDocumentAttest(uploadedId, {
        walletAddress: publicKey.toBase58(),
        tradeId: tradeId || undefined,
      });
      const transaction = Transaction.from(
        Buffer.from(built.transaction, "base64"),
      );
      const signature = await sendTransaction(transaction, connection);
      await confirmTransactionWithTimeout(connection, signature, "confirmed");
      const result = await confirmDocumentAttest(uploadedId, {
        txSignature: signature,
        documentPda: built.documentPda,
      });
      setTxSignature(result.txSignature);
      setDocumentPda(result.documentPda);
      toast.success("单据已上链存证");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "存证上链失败");
    } finally {
      setAttesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>上传文件</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              上传后可使用钱包将文件哈希写入 Solana 存证
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
            <p className="text-muted-foreground">
              拖拽文件到这里，或点击选择文件
            </p>
          </div>

          <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/50 sm:w-auto">
            <Camera className="h-4 w-4" />
            拍照上传
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
                <img
                  src={previewUrl}
                  alt="待上传文件预览"
                  className="h-16 w-16 rounded-md object-cover"
                />
              )}
              <p className="min-w-0 text-sm">
                {file.name}（{(file.size / 1024).toFixed(0)} KB）
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="tradeId">tradeId（可选）</Label>
            <Input
              id="tradeId"
              value={tradeId}
              onChange={(e) => setTradeId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="documentId">
              单据编号（可选，同一编号自动生成新版本）
            </Label>
            <Input
              id="documentId"
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              placeholder="例如 export-invoice"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">描述（可选）</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <Button onClick={() => void handleUpload()} disabled={uploading}>
            {uploading ? "上传中..." : "上传文件"}
          </Button>

          {hash && (
            <p className="break-all rounded-md bg-muted p-3 font-mono text-xs">
              文件哈希：{hash}
              {version ? `（版本 v${version}）` : ""}
            </p>
          )}

          {uploadedId && hash && (
            <div className="space-y-3">
              <Button
                onClick={() => void handleAttest()}
                disabled={attesting || !connected || !!txSignature}
              >
                {attesting
                  ? "签名上链中..."
                  : txSignature
                    ? "已上链存证"
                  : connected
                    ? "存证上链"
                    : "请先连接钱包"}
              </Button>
              {txSignature && (
                <p className="break-all rounded-md bg-muted p-3 font-mono text-xs">
                  交易签名：{txSignature}
                </p>
              )}
              {documentPda && (
                <p className="break-all rounded-md bg-muted p-3 font-mono text-xs">
                  存证账户：{documentPda}
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            支持类型：PDF、PNG、JPEG、DOC、DOCX；最大 50MB；手机可拍照上传
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
