"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { aiChat, type AiAssistantMessage } from "@/lib/api";

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
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AiAssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

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
    try {
      const { reply } = await aiChat(message, messages.slice(-10));
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("shell.aiAssistant.sendFailed"));
      setMessages(messages);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-[#00E676]/50 bg-background/90 px-4 py-2.5 text-sm font-medium text-[#00E676] shadow-[0_0_20px_-6px_rgba(0,230,118,0.6)] backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/10"
      >
        <Bot className="h-4 w-4" />
        {t("shell.aiAssistant.open")}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full max-w-sm flex-col gap-0 p-0 sm:max-w-sm">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-[#00E676]" />
              {t("shell.aiAssistant.title")}
            </SheetTitle>
            <SheetDescription>{t("shell.aiAssistant.desc")}</SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col">
            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
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
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("shell.aiAssistant.quickTitle")}
              </p>
              <div className="mb-3 flex flex-wrap gap-1.5">
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
        </SheetContent>
      </Sheet>
    </>
  );
}
