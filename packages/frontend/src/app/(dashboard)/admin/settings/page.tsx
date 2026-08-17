"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Save, RotateCcw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getSettings,
  resetSettings,
  updateSettings,
  type SystemSettings,
} from "@/lib/settings-api";

/** 工业风开关（零圆角 + 信号绿），项目无现成 Switch 组件 */
function Switch({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`relative h-6 w-11 shrink-0 border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? "border-[#00E676] bg-[#00E676]/15"
          : "border-border bg-muted"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 transition-all ${
          checked
            ? "left-[calc(100%-1.125rem)] bg-[#00E676]"
            : "left-0.5 bg-muted-foreground"
        }`}
      />
    </button>
  );
}

export default function AdminSettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await getSettings());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.saveFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof SystemSettings>(
    section: K,
    patch: Partial<SystemSettings[K]>,
  ) => {
    setSettings((prev) =>
      prev
        ? { ...prev, [section]: { ...prev[section], ...patch } }
        : prev,
    );
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const saved = await updateSettings(settings);
      setSettings(saved);
      toast.success(t("settings.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm(t("settings.resetConfirm"))) return;
    try {
      setSettings(await resetSettings());
      toast.success(t("settings.resetDone"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.saveFailed"));
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-mono text-xl font-semibold">
            <Settings2 className="h-5 w-5 text-[#00E676]" />
            {t("settings.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void handleReset()}>
            <RotateCcw className="mr-1 h-4 w-4" />
            {t("settings.reset")}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            {t("settings.save")}
          </Button>
        </div>
      </div>

      {/* 平台信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.platform")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="platform-name">{t("settings.platform.name")}</Label>
            <Input
              id="platform-name"
              value={settings.platform.name}
              onChange={(e) => set("platform", { name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="support-email">{t("settings.platform.supportEmail")}</Label>
            <Input
              id="support-email"
              type="email"
              value={settings.platform.supportEmail}
              onChange={(e) => set("platform", { supportEmail: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {/* 安全策略 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.security")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="max-failures">{t("settings.security.maxLoginFailures")}</Label>
              <Input
                id="max-failures"
                type="number"
                min={1}
                max={50}
                value={settings.security.maxLoginFailures}
                onChange={(e) =>
                  set("security", {
                    maxLoginFailures: Number(e.target.value) || 1,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lockout">{t("settings.security.lockoutMinutes")}</Label>
              <Input
                id="lockout"
                type="number"
                min={1}
                max={1440}
                value={settings.security.lockoutMinutes}
                onChange={(e) =>
                  set("security", { lockoutMinutes: Number(e.target.value) || 1 })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="session-hours">{t("settings.security.sessionMaxAgeHours")}</Label>
              <Input
                id="session-hours"
                type="number"
                min={1}
                max={720}
                value={settings.security.sessionMaxAgeHours}
                onChange={(e) =>
                  set("security", {
                    sessionMaxAgeHours: Number(e.target.value) || 1,
                  })
                }
              />
            </div>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">
                {t("settings.security.requireTotpForAdmins")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("settings.security.requireTotpForAdminsHint")}
              </p>
            </div>
            <Switch
              checked={settings.security.requireTotpForAdmins}
              onCheckedChange={(v) => set("security", { requireTotpForAdmins: v })}
            />
          </div>
        </CardContent>
      </Card>

      {/* 注册策略 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.registration")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">
                {t("settings.registration.allowRegister")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("settings.registration.allowRegisterHint")}
              </p>
            </div>
            <Switch
              checked={settings.registration.allowRegister}
              onCheckedChange={(v) => set("registration", { allowRegister: v })}
            />
          </div>
        </CardContent>
      </Card>

      {/* 上传策略 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.upload")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="max-size">{t("settings.upload.maxSizeMB")}</Label>
            <Input
              id="max-size"
              type="number"
              min={1}
              max={1024}
              value={settings.upload.maxSizeMB}
              onChange={(e) =>
                set("upload", { maxSizeMB: Number(e.target.value) || 1 })
              }
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">
                {t("settings.upload.allowDuplicate")}
              </p>
            </div>
            <Switch
              checked={settings.upload.allowDuplicate}
              onCheckedChange={(v) => set("upload", { allowDuplicate: v })}
            />
          </div>
        </CardContent>
      </Card>

      {/* 通知设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.notifications")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t("settings.notificationsHint")}
          </p>
          {(
            [
              ["fileReviewed", "settings.notifications.fileReviewed"],
              ["tradeStatus", "settings.notifications.tradeStatus"],
              ["withdrawalStatus", "settings.notifications.withdrawalStatus"],
              ["system", "settings.notifications.system"],
            ] as const
          ).map(([key, labelKey]) => (
            <div
              key={key}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <p className="text-sm font-medium">{t(labelKey)}</p>
              <Switch
                checked={settings.notifications[key]}
                onCheckedChange={(v) =>
                  set("notifications", { [key]: v })
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
