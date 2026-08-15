"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Plus, RefreshCw, Send, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchApiKeys,
  createApiKey,
  revokeApiKey,
  fetchWebhooks,
  createWebhook,
  deleteWebhook,
  testWebhook,
  type ApiKeyRecord,
  type WebhookRecord,
} from "@/lib/integrations-api";
import { formatDateTime } from "@/lib/format";

type Tab = "keys" | "webhooks";

function copyText(value: string, successMsg: string) {
  void navigator.clipboard.writeText(value).then(
    () => toast.success(successMsg),
    () => toast.error(successMsg),
  );
}

export default function IntegrationsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("keys");
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [hooks, setHooks] = useState<WebhookRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [keyName, setKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [hookName, setHookName] = useState("");
  const [hookUrl, setHookUrl] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [k, h] = await Promise.all([fetchApiKeys(), fetchWebhooks()]);
      setKeys(k.items);
      setHooks(h.items);
    } catch {
      /* handled by http layer */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateKey = async () => {
    if (!keyName.trim()) return;
    setBusy(true);
    try {
      const res = await createApiKey({ name: keyName.trim() });
      setCreatedKey(res.key);
      setKeyName("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    await revokeApiKey(id).catch(() => undefined);
    await load();
  };

  const handleCreateHook = async () => {
    if (!hookName.trim() || !hookUrl.trim()) return;
    setBusy(true);
    try {
      const res = await createWebhook({ name: hookName.trim(), url: hookUrl.trim(), events: ["FILE_REVIEWED", "TRADE_STATUS", "WITHDRAWAL_STATUS"] });
      setCreatedSecret(res.secret);
      setHookName("");
      setHookUrl("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-2 font-mono text-xl font-bold">
          <WebhookIcon className="h-5 w-5 text-[#00E676]" />
          {t("panels.integrations.title")}
        </h1>
        <div className="flex items-center gap-2">
          {(["keys", "webhooks"] as const).map((k) => (
            <Button key={k} variant={tab === k ? "default" : "outline"} size="sm" onClick={() => setTab(k)}>
              {t(`panels.integrations.tab${k === "keys" ? "ApiKeys" : "Webhooks"}`)}
            </Button>
          ))}
          <Button variant="ghost" size="icon" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {tab === "keys" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("panels.integrations.keyName")}</Label>
                  <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="CI / 第三方系统" />
                </div>
                <Button onClick={() => void handleCreateKey()} disabled={busy || !keyName.trim()}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  {t("panels.integrations.createKey")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {createdKey && (
            <div className="rounded-md border border-[#00E676]/40 bg-[#00E676]/10 p-4">
              <p className="mb-1 font-mono text-xs break-all">{createdKey}</p>
              <Button variant="outline" size="sm" onClick={() => copyText(createdKey, t("panels.integrations.copied"))}>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                {t("panels.integrations.copyKey")}
              </Button>
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              {loading ? (
                <p className="p-6 text-sm text-muted-foreground">{t("panels.integrations.loading")}</p>
              ) : keys.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">{t("panels.integrations.empty")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("panels.integrations.keyName")}</TableHead>
                      <TableHead>Prefix</TableHead>
                      <TableHead>{t("panels.integrations.keyRole")}</TableHead>
                      <TableHead>{t("panels.integrations.createdAt")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((k) => (
                      <TableRow key={k.id}>
                        <TableCell>{k.name}</TableCell>
                        <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                        <TableCell><Badge variant="outline">{k.role}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{formatDateTime(k.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void handleRevokeKey(k.id)}>
                            <Trash2 className="mr-1 h-3 w-3" />
                            {t("panels.integrations.revoke")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "webhooks" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("panels.integrations.webhookName")}</Label>
                <Input value={hookName} onChange={(e) => setHookName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("panels.integrations.webhookUrl")}</Label>
                <Input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://..." />
              </div>
              <Button className="self-end" onClick={() => void handleCreateHook()} disabled={busy || !hookName.trim() || !hookUrl.trim()}>
                <Plus className="mr-1.5 h-4 w-4" />
                {t("panels.integrations.addWebhook")}
              </Button>
            </CardContent>
          </Card>

          {createdSecret && (
            <div className="rounded-md border border-[#00E676]/40 bg-[#00E676]/10 p-4">
              <p className="mb-1 font-mono text-xs break-all">{createdSecret}</p>
              <Button variant="outline" size="sm" onClick={() => copyText(createdSecret, t("panels.integrations.copied"))}>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                {t("panels.integrations.copySecret")}
              </Button>
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              {loading ? (
                <p className="p-6 text-sm text-muted-foreground">{t("panels.integrations.loading")}</p>
              ) : hooks.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">{t("panels.integrations.empty")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("panels.integrations.webhookName")}</TableHead>
                      <TableHead>URL</TableHead>
                      <TableHead>{t("panels.integrations.events")}</TableHead>
                      <TableHead>{t("panels.integrations.lastSent")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hooks.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell>
                          {h.name}
                          <Badge variant={h.active ? "default" : "secondary"} className="ml-2">
                            {h.active ? t("panels.integrations.active") : t("panels.integrations.inactive")}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate font-mono text-xs">{h.url}</TableCell>
                        <TableCell className="max-w-[180px]">
                          <div className="flex flex-wrap gap-1">
                            {h.events.map((e) => (
                              <Badge key={e} variant="outline" className="font-mono text-[10px]">{e}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{h.lastSentAt ? formatDateTime(h.lastSentAt) : t("panels.integrations.never")}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => void (async () => {
                            const res = await testWebhook(h.id);
                            toast.success(res.ok ? t("panels.integrations.testOk") : `${t("panels.integrations.testFail")}: ${res.message}`);
                          })()}>
                            <Send className="mr-1 h-3 w-3" />
                            {t("panels.integrations.test")}
                          </Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void (async () => {
                            await deleteWebhook(h.id);
                            await load();
                          })()}>
                            <Trash2 className="mr-1 h-3 w-3" />
                            {t("panels.integrations.delete")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
