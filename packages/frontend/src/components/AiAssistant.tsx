"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLanguage } from "@/components/LanguageProvider";
import {
  ArrowLeft,
  Bot,
  History,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  aiChat,
  deleteAiHistory,
  fetchAiHistory,
  fetchAiSession,
  type AiAssistantMessage,
  type AiSessionMeta,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

/** 常用快捷指令：点击后直接发给 AI 助手 */
const QUICK_COMMANDS = [
  "shell.ai.commands.upload",
  "shell.ai.commands.createOrder",
  "shell.ai.commands.bindWallet",
  "shell.ai.commands.totp",
  "shell.ai.commands.review",
  "shell.ai.commands.financing",
  "shell.ai.commands.feedback",
  "shell.ai.commands.roles",
] as const;

export function AiAssistant() {
  const { t } = useTranslation();
  const { locale } = useLanguage();
  const [open, setOpen] = useState(false);
  const [showQuick, setShowQuick] = useState(true);
  const [messages, setMessages] = useState<AiAssistantMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<AiSessionMeta[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const refreshSessions = async () => {
    try {
      setSessions(await fetchAiHistory());
    } catch {
      // 历史列表加载失败不阻塞聊天
    }
  };

  useEffect(() => {
    if (!open) return;
    setLoadingHistory(true);
    void fetchAiHistory()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoadingHistory(false));
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const handleSend = async (raw?: string) => {
    const message = (raw ?? input).trim();
    if (!message || sending) return;
    const next: AiAssistantMessage[] = [...messages, { role: "user", content: message }];
    setMessages(next);
    setInput("");
    setSending(true);
    setShowQuick(false);
    try {
      const { reply, sessionId: sid } = await aiChat(
        message,
        messages.slice(-10),
        sessionId,
        locale,
      );
      setSessionId(sid);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      void refreshSessions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("shell.aiAssistant.sendFailed"));
      setMessages(messages);
    } finally {
      setSending(false);
    }
  };

  const restoreSession = async (sid: string) => {
    try {
      const session = await fetchAiSession(sid);
      setMessages(session.messages);
      setSessionId(session.id);
      setHistoryOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("shell.aiAssistant.sendFailed"));
    }
  };

  const removeSession = async (sid: string) => {
    try {
      await deleteAiHistory(sid);
      setSessions((prev) => prev.filter((s) => s.id !== sid));
      if (sessionId === sid) {
        setSessionId(undefined);
        setMessages([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("shell.aiAssistant.sendFailed"));
    }
  };

  const clearAll = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    try {
      await deleteAiHistory();
      setSessions([]);
      setSessionId(undefined);
      setMessages([]);
      setConfirmClear(false);
      toast.success(t("shell.aiAssistant.historyCleared"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("shell.aiAssistant.sendFailed"));
    }
  };

  const newChat = () => {
    setMessages([]);
    setSessionId(undefined);
    setHistoryOpen(false);
    setShowQuick(true);
  };

  const latest = sessions[0];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-[#00E676]/60 bg-[#00E676] px-4 py-2.5 text-sm font-semibold text-emerald-950 shadow-[0_0_20px_-4px_rgba(0,230,118,0.7)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#00E676]/90"
      >
        <Bot className="h-4 w-4" />
        {t("shell.aiAssistant.open")}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" hideClose className="flex w-full max-w-sm flex-col gap-0 p-0 sm:max-w-sm">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#00E676]" />
                {t("shell.aiAssistant.title")}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title={t("shell.aiAssistant.history")}
                  onClick={() => setHistoryOpen((v) => !v)}
                >
                  <History className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title={t("shell.aiAssistant.newChat")}
                  onClick={newChat}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <SheetClose asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title={t("close")}
                    aria-label={t("close")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </SheetClose>
              </span>
            </SheetTitle>
            <SheetDescription>{t("shell.aiAssistant.desc")}</SheetDescription>
          </SheetHeader>

          {historyOpen ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setHistoryOpen(false)}
                >
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                  {t("shell.aiAssistant.historyBack")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={confirmClear ? "text-red-500" : ""}
                  onClick={() => void clearAll()}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {confirmClear
                    ? t("shell.aiAssistant.clearConfirm")
                    : t("shell.aiAssistant.clearAll")}
                </Button>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {loadingHistory && sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("shell.aiAssistant.historyLoading")}</p>
                ) : sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("shell.aiAssistant.historyEmpty")}</p>
                ) : (
                  sessions.map((s) => (
                    <div
                      key={s.id}
                      className="group flex cursor-pointer items-center gap-2 rounded-md border border-border p-2.5 transition-colors hover:border-[#00E676]/50"
                      onClick={() => void restoreSession(s.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">{s.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(s.updatedAt)} · {s.messageCount} {t("shell.aiAssistant.messagesUnit")}
                        </p>
                      </div>
                      <button
                        type="button"
                        title={t("shell.aiAssistant.deleteSession")}
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeSession(s.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {messages.length === 0 && latest && (
                <div className="border-b border-border/60 px-4 py-2.5">
                  <p className="mb-1.5 text-xs text-muted-foreground">
                    {t("shell.aiAssistant.restoreHint")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-[#00E676]/50 text-[#00E676]"
                    onClick={() => void restoreSession(latest.id)}
                  >
                    <History className="mr-1.5 h-3.5 w-3.5" />
                    {t("shell.aiAssistant.restore", { title: latest.title })}
                  </Button>
                </div>
              )}
              <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4 pb-8">
                {messages.length === 0 && (
                  <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground">
                    {t("shell.aiAssistant.welcome")}
                  </p>
                )}
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`max-w-[88%] whitespace-pre-line rounded-lg px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "ml-auto bg-primary/10 text-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    {m.content}
                  </div>
                ))}
                {sending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("shell.aiAssistant.thinking")}
                  </div>
                )}
              </div>

              <div className="border-t p-3">
                {showQuick && (
                  <>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("shell.aiAssistant.quickTitle")}
                    </p>
                    <div className="mb-3 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                      {QUICK_COMMANDS.map((key) => (
                        <button
                          key={key}
                          type="button"
                          disabled={sending}
                          onClick={() => void handleSend(t(key))}
                          className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-[#00E676]/50 hover:text-[#00E676] disabled:opacity-50"
                        >
                          {t(key)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder={t("shell.aiAssistant.inputPlaceholder")}
                    disabled={sending}
                  />
                  <Button
                    size="icon"
                    onClick={() => void handleSend()}
                    disabled={sending || !input.trim()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
          <div className="border-t px-4 py-2 text-center text-[11px] text-muted-foreground">
            {t("ai.disclaimer")}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
