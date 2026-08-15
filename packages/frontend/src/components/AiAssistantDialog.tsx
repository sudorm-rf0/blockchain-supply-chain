"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, FileSearch, ListChecks, Loader2, MessageSquareText, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  aiChatFile,
  aiExtractFile,
  aiReviewFile,
  aiSummarizeFile,
  type AiChatMessage,
  type AiReviewReport,
  type FileRecord,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface AiAssistantDialogProps {
  file: FileRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type View = "review" | "extract" | "summary" | "chat";

const RISK_STYLE: Record<string, string> = {
  LOW: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  MEDIUM: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  HIGH: "bg-red-500/10 text-red-600 border-red-500/30",
};

const FIELD_LABELS: Record<string, string> = {
  invoiceNumber: "files.ai.field.invoiceNumber",
  contractNo: "files.ai.field.contractNo",
  amount: "files.ai.field.amount",
  date: "files.ai.field.date",
  buyer: "files.ai.field.buyer",
  seller: "files.ai.field.seller",
  currency: "files.ai.field.currency",
  preEntryNo: "files.ai.field.preEntryNo",
  customsNo: "files.ai.field.customsNo",
  consignee: "files.ai.field.consignee",
  shipper: "files.ai.field.shipper",
  transportMode: "files.ai.field.transportMode",
  notes: "files.ai.field.notes",
};

export function AiAssistantDialog({ file, open, onOpenChange }: AiAssistantDialogProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("review");
  const [report, setReport] = useState<AiReviewReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [extractData, setExtractData] = useState<Record<string, unknown> | null>(null);
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setView("review");
    setReport(null);
    setReportError(null);
    setExtractData(null);
    setExtractError(null);
    setSummaryText(null);
    setSummaryError(null);
    setMessages([]);
    setInput("");
    setReportLoading(true);
    void aiReviewFile(file.id)
      .then((r) => setReport(r))
      .catch((error) =>
        setReportError(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setReportLoading(false));
  }, [open, file.id]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const loadExtract = async () => {
    if (extractData || extractLoading) return;
    setExtractLoading(true);
    try {
      const { fields } = await aiExtractFile(file.id);
      setExtractData(fields);
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : String(error));
    } finally {
      setExtractLoading(false);
    }
  };

  const loadSummary = async () => {
    if (summaryText || summaryLoading) return;
    setSummaryLoading(true);
    try {
      const { summary } = await aiSummarizeFile(file.id);
      setSummaryText(summary);
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : String(error));
    } finally {
      setSummaryLoading(false);
    }
  };

  const onSelectView = (next: View) => {
    setView(next);
    if (next === "extract") void loadExtract();
    if (next === "summary") void loadSummary();
  };

  const handleSend = async () => {
    const message = input.trim();
    if (!message || sending) return;
    const next: AiChatMessage[] = [...messages, { role: "user", content: message }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const { reply } = await aiChatFile(file.id, {
        message,
        history: messages.slice(-10),
      });
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("files.ai.chatFailed"));
      setMessages(messages);
    } finally {
      setSending(false);
    }
  };

  const tabs: Array<{ key: View; label: string; icon: typeof Bot }> = [
    { key: "review", label: t("files.ai.tab.review"), icon: ListChecks },
    { key: "extract", label: t("files.ai.tab.extract"), icon: FileSearch },
    { key: "summary", label: t("files.ai.tab.summary"), icon: Sparkles },
    { key: "chat", label: t("files.ai.tab.chat"), icon: MessageSquareText },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            {t("files.ai.title")}
          </DialogTitle>
          <DialogDescription className="truncate">
            {file.filename}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-md border border-border p-1">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onSelectView(key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs font-medium transition-colors",
                view === key
                  ? "bg-primary/10 text-[#00E676]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {view === "review" && (
          <div className="rounded-md border p-3">
            {reportLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("files.ai.reviewing")}
              </div>
            ) : reportError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{reportError}</p>
            ) : report ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{t("files.ai.riskLevel")}:</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RISK_STYLE[report.riskLevel] ?? ""}`}
                  >
                    {t(`files.ai.risk.${report.riskLevel}`, { defaultValue: report.riskLevel })}
                  </span>
                </div>
                <p className="text-foreground">{report.summary}</p>
                {report.riskAssessment && (
                  <p className="text-muted-foreground">{report.riskAssessment}</p>
                )}
                {report.suggestions.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {report.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
                {report.concerns.length > 0 && (
                  <>
                    <p className="pt-1 text-xs font-semibold text-muted-foreground">
                      {t("files.ai.concerns")}
                    </p>
                    <ul className="list-disc space-y-1 pl-5 text-amber-600 dark:text-amber-400">
                      {report.concerns.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}

        {view === "extract" && (
          <div className="rounded-md border p-3">
            {extractLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("files.ai.extracting")}
              </div>
            ) : extractError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{extractError}</p>
            ) : extractData ? (
              <div className="space-y-2 text-sm">
                {Object.entries(extractData)
                  .filter(([, v]) => v !== null && v !== undefined && v !== "")
                  .map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-4 border-b border-border/50 py-1.5 last:border-0">
                      <span className="shrink-0 text-muted-foreground">
                        {t(FIELD_LABELS[k] ?? `files.ai.field.${k}`, { defaultValue: k })}
                      </span>
                      <span className="text-right text-foreground">{String(v)}</span>
                    </div>
                  ))}
              </div>
            ) : null}
          </div>
        )}

        {view === "summary" && (
          <div className="rounded-md border p-3">
            {summaryLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("files.ai.summarizing")}
              </div>
            ) : summaryError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{summaryError}</p>
            ) : summaryText ? (
              <p className="whitespace-pre-line text-sm leading-6 text-foreground">{summaryText}</p>
            ) : null}
          </div>
        )}

        {view === "chat" && (
          <div className="rounded-md border">
            <div ref={listRef} className="flex max-h-72 flex-col gap-2 overflow-y-auto p-3">
              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("files.ai.chatPlaceholder")}</p>
              ) : (
                messages.map((m, i) => (
                  <div
                    key={i}
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "self-end bg-primary/10 text-foreground"
                        : "self-start bg-muted text-foreground"
                    }`}
                  >
                    {m.content}
                  </div>
                ))
              )}
              {sending && (
                <div className="flex items-center gap-2 self-start text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("files.ai.thinking")}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 border-t p-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={t("files.ai.chatInput")}
                disabled={sending}
              />
              <Button size="icon" onClick={() => void handleSend()} disabled={sending || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
