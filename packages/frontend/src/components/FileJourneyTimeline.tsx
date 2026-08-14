"use client";

import { useTranslation } from "react-i18next";
import { Check, Clock, ScanText, ShieldCheck, Upload } from "lucide-react";
import type { FileRecord } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

interface FileJourneyTimelineProps {
  file: FileRecord;
}

/** 供应链旅程时间线：上传 → 智能分析 → 链上存证 → 审核 */
export function FileJourneyTimeline({ file }: FileJourneyTimelineProps) {
  const { t } = useTranslation();

  const steps: {
    key: string;
    title: string;
    time: string | null | undefined;
    desc: string;
    icon: typeof Upload;
    state: "done" | "current" | "pending";
  }[] = [
    {
      key: "upload",
      title: t("journey.upload"),
      time: file.createdAt,
      desc: t("journey.uploadDesc", { name: file.filename }),
      icon: Upload,
      state: "done",
    },
    {
      key: "analysis",
      title: t("journey.analysis"),
      time: file.analyzedAt,
      desc:
        file.authScore != null
          ? t("journey.analysisDesc", { score: file.authScore })
          : file.ocrStatus === "PROCESSING" || file.authStatus === "PROCESSING"
            ? t("journey.analysisProcessing")
            : t("journey.analysisPending"),
      icon: ScanText,
      state:
        file.analyzedAt || file.authStatus === "SUCCESS"
          ? "done"
          : file.ocrStatus === "PROCESSING" || file.authStatus === "PROCESSING"
            ? "current"
            : "pending",
    },
    {
      key: "attest",
      title: t("journey.attest"),
      time: file.attestedAt,
      desc: file.txSignature
        ? t("journey.attestDesc", { tx: file.txSignature.slice(0, 12) })
        : t("journey.attestPending"),
      icon: ShieldCheck,
      state: file.attestedAt ? "done" : "pending",
    },
    {
      key: "review",
      title: t("journey.review"),
      time: null,
      desc:
        file.status === "APPROVED"
          ? t("journey.reviewApproved")
          : file.status === "REJECTED"
            ? t("journey.reviewRejected")
            : t("journey.reviewPending"),
      icon: Check,
      state:
        file.status === "APPROVED" || file.status === "REJECTED"
          ? "done"
          : "current",
    },
  ];

  return (
    <div className="space-y-0">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const Icon = step.icon;
        return (
          <div key={step.key} className="relative flex gap-3 pb-5">
            {/* 连接线 */}
            {!last && (
              <div
                className={`absolute left-[13px] top-7 h-[calc(100%-20px)] w-0.5 ${
                  step.state === "done" ? "bg-[#00E676]" : "bg-border"
                }`}
              />
            )}
            {/* 节点 */}
            <div
              className={`z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                step.state === "done"
                  ? "border-[#00E676] bg-[#00E676]/15 text-[#00E676]"
                  : step.state === "current"
                    ? "border-amber-500 bg-amber-500/15 text-amber-500"
                    : "border-border bg-muted text-muted-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
            </div>
            {/* 内容 */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{step.title}</p>
                {step.state === "done" && step.time && (
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(step.time)}
                  </span>
                )}
                {step.state === "current" && (
                  <span className="flex items-center gap-1 text-xs text-amber-500">
                    <Clock className="h-3 w-3" />
                    {t("journey.current")}
                  </span>
                )}
              </div>
              <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                {step.desc}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
