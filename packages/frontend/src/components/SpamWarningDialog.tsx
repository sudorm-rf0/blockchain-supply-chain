"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MailWarning } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const SPAM_HINT_KEY = "dfr-spam-hint-dismissed";

/** 用户是否选择过「不再提示」（用于发送验证码前决定是否弹提醒） */
export function shouldShowSpamHint(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(SPAM_HINT_KEY) !== "1";
  } catch {
    return true;
  }
}

interface SpamWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 验证码邮件可能被归入垃圾箱的提醒弹窗。
 * 带「不再提示」选项（localStorage 持久化）。
 */
export function SpamWarningDialog({ open, onOpenChange }: SpamWarningDialogProps) {
  const { t } = useTranslation();
  const [dontAsk, setDontAsk] = useState(false);

  const handleClose = (dismiss: boolean) => {
    if (dismiss && dontAsk) {
      try {
        localStorage.setItem(SPAM_HINT_KEY, "1");
      } catch {
        // ignore
      }
    }
    onOpenChange(false);
    setDontAsk(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && handleClose(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <MailWarning className="h-5 w-5 text-amber-500" />
            {t("spamHint.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("spamHint.desc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center gap-2">
          <input
            id="spam-dont-ask"
            type="checkbox"
            checked={dontAsk}
            onChange={(e) => setDontAsk(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <label htmlFor="spam-dont-ask" className="text-sm text-muted-foreground">
            {t("spamHint.dontAsk")}
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => handleClose(false)}>
            {t("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => handleClose(true)}>
            {t("spamHint.gotIt")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
