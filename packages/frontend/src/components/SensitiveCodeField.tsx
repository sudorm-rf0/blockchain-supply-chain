"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SensitiveCodeFieldProps {
  id: string;
  /** 已开启两步验证（TOTP）：显示两步验证码输入；否则显示邮箱验证码输入 */
  totpEnabled: boolean;
  value: string;
  onChange: (value: string) => void;
  /** 邮箱验证码模式下的「发送验证码」回调（可选） */
  onSend?: () => void;
  sending?: boolean;
  cooldown?: number;
  /** 覆盖邮箱验证码提示文案 */
  emailHint?: string;
}

/** 敏感操作验证码输入：开启两步验证 → 两步验证码；未开启 → 邮箱验证码 */
export function SensitiveCodeField({
  id,
  totpEnabled,
  value,
  onChange,
  onSend,
  sending,
  cooldown,
  emailHint,
}: SensitiveCodeFieldProps) {
  const { t } = useTranslation();

  if (totpEnabled) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{t("account.totpCode")}</Label>
        <Input
          id={id}
          inputMode="numeric"
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
          placeholder={t("account.totpPlaceholder")}
          autoComplete="one-time-code"
        />
        <p className="text-xs text-muted-foreground">{t("account.totpHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("account.emailCode")}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          inputMode="numeric"
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
          placeholder={t("account.codePlaceholder")}
        />
        {onSend && (
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            disabled={sending || (cooldown ?? 0) > 0}
            onClick={onSend}
          >
            {(cooldown ?? 0) > 0
              ? `${cooldown}s`
              : sending
                ? t("account.sending")
                : t("account.sendCode")}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {emailHint ?? t("account.sensitiveCodeHint")}
      </p>
    </div>
  );
}
