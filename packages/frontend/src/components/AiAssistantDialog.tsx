"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Loader2, Send } from "lucide-react";
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
import { aiChatFile, aiReviewFile, type AiChatMessage, type AiReviewReport, type FileRecord } from "@/lib/api";

interface AiAssistantDialogProps {
  file: FileRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RISK_STYLE: Record<string, string> = {
  LOW: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  MEDIUM: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  HIGH: "bg-red-500/10 text-red-600 border-red-500/30",
};

export function AiAssistantDialog({ file, open, onOpenChange }: AiAssistantDialogProps) {
  const { t } = useTranslation();
  const [report, setReport] = useState<AiReviewReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setReport(null);
    setReportError(null);
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

        <div className="space-y-4">
          <div className="rounded-md border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("files.ai.reviewTitle")}
            </p>
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

          <div className="rounded-md border">
            <div ref={listRef} className="flex max-h-56 flex-col gap-2 overflow-y-auto p-3">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
