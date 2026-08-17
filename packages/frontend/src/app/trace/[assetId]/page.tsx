"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ExternalLink, Loader2, Route, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LogoMark } from "@/components/LogoMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { formatDateTime } from "@/lib/format";

interface TraceEvent {
  type: string;
  label: string;
  timestamp: string;
  detail?: string;
  txSignature?: string;
  solscanUrl?: string;
}

interface TraceResult {
  ok: boolean;
  error?: string;
  asset?: { type: string; id: string; name: string; status?: string; uploaderName?: string | null };
  events?: TraceEvent[];
}

const EVENT_ICONS: Record<string, string> = {
  UPLOAD: "⬆️",
  ANALYZE: "🔍",
  ATTEST: "🔗",
  TRADE_CREATED: "📝",
  TRADE_ONCHAIN: "⛓️",
  PRODUCT_CREATED: "📦",
};

function TraceBody() {
  const { t } = useTranslation();
  const params = useParams<{ assetId: string }>();
  const assetId = params?.assetId ?? "";
  const [result, setResult] = useState<TraceResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!assetId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/public/trace/${encodeURIComponent(assetId)}`);
        const data = (await res.json()) as TraceResult;
        setResult(data);
      } catch {
        setResult({ ok: false, error: "network" });
      } finally {
        setLoading(false);
      }
    })();
  }, [assetId]);

  const assetTypeLabel = (type?: string) =>
    type === "FILE" ? t("onchain.trace.file") : type === "TRADE" ? t("onchain.trace.trade") : t("onchain.trace.product");

  return (
    <div className="min-h-screen bg-[#070808] px-4 py-8 text-[#EDEDED]">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <Link href="/verify" className="inline-flex items-center gap-3">
            <LogoMark className="h-8 w-8" />
            <span className="font-mono text-sm tracking-widest">DFR SUPPLY CHAIN</span>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <div className="mb-6 flex items-center justify-between">
          <h1 className="flex items-center gap-2 font-mono text-2xl font-bold">
            <Route className="h-6 w-6 text-[#00E676]" />
            {t("onchain.trace.title")}
          </h1>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/verify">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              {t("onchain.trace.back")}
            </Link>
          </Button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("onchain.trace.loading")}
          </div>
        )}

        {!loading && (!result?.ok || !result.asset) && (
          <Card className="border-border/60 bg-[#0d0f0e]">
            <CardContent className="p-6 text-sm text-destructive">
              {t("onchain.trace.notFound")}
            </CardContent>
          </Card>
        )}

        {result?.ok && result.asset && (
          <div className="space-y-6">
            <Card className="border-border/60 bg-[#0d0f0e]">
              <CardContent className="flex flex-wrap items-center gap-3 p-5">
                <Badge variant="outline" className="border-[#00E676]/40 bg-[#00E676]/10 text-[#00E676]">
                  {assetTypeLabel(result.asset.type)}
                </Badge>
                <span className="truncate font-mono text-sm">{result.asset.name}</span>
                {result.asset.uploaderName && (
                  <span className="text-xs text-muted-foreground">{result.asset.uploaderName}</span>
                )}
                {result.asset.status && (
                  <span className="ml-auto font-mono text-xs text-muted-foreground">{result.asset.status}</span>
                )}
              </CardContent>
            </Card>

            <h2 className="flex items-center gap-2 font-mono text-sm font-semibold text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-[#00E676]" />
              {t("onchain.trace.events")}
            </h2>

            <ol className="space-y-0 border-l border-border/60 pl-5">
              {(result.events ?? []).map((ev, i) => (
                <li key={i} className="relative pb-6 last:pb-0">
                  <span className="absolute -left-[27px] top-1 flex h-3 w-3 items-center justify-center rounded-full bg-[#00E676]" />
                  <div className="rounded-md border border-border/60 bg-[#0d0f0e] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <span>{EVENT_ICONS[ev.type] ?? "•"}</span>
                        {ev.label}
                      </span>
                      <time className="font-mono text-xs text-muted-foreground">
                        {formatDateTime(ev.timestamp)}
                      </time>
                    </div>
                    {ev.detail && <p className="mt-1 text-xs text-muted-foreground">{ev.detail}</p>}
                    {ev.txSignature && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="max-w-[70%] truncate font-mono text-xs text-muted-foreground">
                          {t("onchain.trace.txSignature")}: {ev.txSignature}
                        </span>
                        {ev.solscanUrl && (
                          <a
                            href={ev.solscanUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-[#00E676] underline-offset-4 hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {t("onchain.verify.solscan")}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {(result.events ?? []).length === 0 && (
                <li className="text-sm text-muted-foreground">{t("onchain.activity.empty")}</li>
              )}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TracePage() {
  return (
    <Suspense fallback={null}>
      <TraceBody />
    </Suspense>
  );
}
