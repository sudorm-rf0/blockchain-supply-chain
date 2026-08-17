"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Download, RefreshCw } from "lucide-react";
import { BACKEND_URL } from "@/lib/env";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchFeedbackList,
  processFeedback,
  type FeedbackItem,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export default function AdminFeedbackPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [status, setStatus] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchFeedbackList(status));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("feedbackAdmin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const markProcessed = async (id: string) => {
    setBusyId(id);
    try {
      await processFeedback(id);
      toast.success(t("feedbackAdmin.processed"));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("feedbackAdmin.actionFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("feedbackAdmin.title")}</h1>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("feedbackAdmin.filterAll")}</SelectItem>
              <SelectItem value="NEW">{t("feedbackAdmin.statusNew")}</SelectItem>
              <SelectItem value="PROCESSED">{t("feedbackAdmin.statusProcessed")}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" asChild>
            <a href={`${BACKEND_URL}/api/admin/feedback/export`}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {t("feedbackAdmin.exportCsv")}
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t("feedbackAdmin.refresh")}
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("feedbackAdmin.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("feedbackAdmin.empty")}</p>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {item.userEmail ?? t("feedbackAdmin.anonymous")}
                  </span>
                  <Badge
                    className={
                      item.status === "NEW"
                        ? "bg-amber-500/10 text-amber-600"
                        : "bg-emerald-500/10 text-emerald-600"
                    }
                  >
                    {item.status === "NEW"
                      ? t("feedbackAdmin.statusNew")
                      : t("feedbackAdmin.statusProcessed")}
                  </Badge>
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(item.createdAt)}
                </span>
              </CardHeader>
              <CardContent className="space-y-2 pt-0 text-sm">
                <p className="whitespace-pre-line text-foreground">{item.content}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {t("feedbackAdmin.contact")}: {item.contact ?? t("feedbackAdmin.noContact")}
                  </span>
                  {item.status === "NEW" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === item.id}
                      onClick={() => void markProcessed(item.id)}
                    >
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      {t("feedbackAdmin.markProcessed")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
