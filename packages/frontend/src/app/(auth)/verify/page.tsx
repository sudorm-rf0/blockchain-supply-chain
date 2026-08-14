"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { ShieldCheck, ShieldX, FileSearch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { FileRecord } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

type VerifyData = {
  ok: boolean;
  error?: string;
  file?: FileRecord;
};

const ORIGIN =
  typeof window !== "undefined" ? window.location.origin : "";

export default function VerifyPage() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const hash = params.get("h") ?? "";
  const [data, setData] = useState<VerifyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`${ORIGIN}/api/public/verify?hash=${encodeURIComponent(hash)}`);
        const json = (await res.json()) as VerifyData;
        if (active) setData(json);
      } catch {
        if (active) setData({ ok: false, error: "network error" });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [hash]);

  const statusLabel = (status: string) =>
    status === "APPROVED"
      ? t("files.statusApproved")
      : status === "REJECTED"
        ? t("files.statusRejected")
        : t("files.statusPending");

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-center">
          <FileSearch className="h-5 w-5 text-[#00E676]" />
          {t("verify.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <p className="py-8 text-center text-sm text-muted-foreground">{t("verify.loading")}</p>}

        {!loading && data?.ok === false && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <ShieldX className="h-12 w-12 text-red-500" />
            <p className="font-medium">{t("verify.notFound")}</p>
            <p className="break-all font-mono text-xs text-muted-foreground">{hash}</p>
          </div>
        )}

        {!loading && data?.file && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-8 w-8 text-[#00E676]" />
              <div>
                <p className="font-semibold">{t("verify.verified")}</p>
                <p className="text-xs text-muted-foreground">{t("verify.verifiedDesc")}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">{t("files.name")}</p>
                <p className="break-all">{data.file.filename}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("files.status")}</p>
                <Badge>{statusLabel(data.file.status)}</Badge>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground">{t("files.hash")}</p>
                <p className="break-all font-mono text-xs">{data.file.hash}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("verify.uploadTime")}</p>
                <p>{formatDateTime(data.file.createdAt)}</p>
              </div>
              {data.file.uploaderName && (
                <div>
                  <p className="text-muted-foreground">{t("verify.uploader")}</p>
                  <p>{data.file.uploaderName}</p>
                </div>
              )}
            </div>

            {data.file.attestedAt && data.file.txSignature && (
              <div className="rounded-md border border-[#00E676]/40 bg-[#00E676]/5 p-3">
                <p className="text-sm font-medium text-[#00E676]">
                  {t("verify.attested", { time: formatDateTime(data.file.attestedAt) })}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {data.file.txSignature}
                </p>
              </div>
            )}

            {data.file.authScore != null && (
              <div className="rounded-md border p-3">
                <p className="text-sm text-muted-foreground">{t("verify.authScore")}</p>
                <p className={`mt-1 font-mono text-lg font-semibold ${
                  data.file.authScore >= 80
                    ? "text-[#00E676]"
                    : data.file.authScore >= 55
                      ? "text-amber-500"
                      : "text-red-500"
                }`}>
                  {data.file.authScore}
                </p>
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              {t("verify.loginHint")}{" "}
              <Link href="/login" className="text-[#00E676] hover:underline">
                {t("verify.login")}
              </Link>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
