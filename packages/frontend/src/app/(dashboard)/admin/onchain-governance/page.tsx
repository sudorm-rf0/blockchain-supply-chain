"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Landmark, Network, ShieldCheck, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchGovernanceStatus,
  type GovernanceStatus,
} from "@/lib/governance-api";

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-right text-sm ${mono ? "break-all font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

export default function OnchainGovernancePage() {
  const { t } = useTranslation();
  const [data, setData] = useState<GovernanceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        setData(await fetchGovernanceStatus());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("panels.reports.loading")}</div>;
  }
  if (error) {
    return <div className="p-6 text-sm text-destructive">{error}</div>;
  }
  if (!data) return null;

  const placeholder = data.network.devnetPlaceholder;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="flex items-center gap-2 font-mono text-xl font-bold">
        <ShieldCheck className="h-5 w-5 text-[#00E676]" />
        {t("panels.governance.title")}
      </h1>

      {placeholder.tradeFinance || placeholder.supplyChain ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("panels.governance.devnetPlaceholder")} — {t("panels.governance.multisigMissing")}
          </span>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-4 w-4 text-[#00E676]" />
            {t("panels.governance.network")}
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border/60 text-sm">
          <Row label={t("panels.governance.cluster")} value={<Badge variant="outline">{data.network.cluster}</Badge>} />
          <Row label={t("panels.governance.rpc")} value={data.network.rpc} mono />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4 text-[#00E676]" />
            {t("panels.governance.programs")}
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border/60 text-sm">
          {(["tradeFinance", "supplyChain"] as const).map((key) => {
            const p = data.programs[key];
            const label = key === "tradeFinance" ? t("panels.governance.tradeFinance") : t("panels.governance.supplyChain");
            return (
              <div key={key} className="py-2">
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-medium">{label}</span>
                  {p.devnetPlaceholder ? (
                    <Badge className="bg-amber-500/15 text-amber-500">{t("panels.governance.devnetPlaceholder")}</Badge>
                  ) : (
                    <Badge className="bg-[#00E676]/10 text-[#00E676]">OK</Badge>
                  )}
                </div>
                <Row label={t("panels.governance.programId")} value={p.programId} mono />
                <Row
                  label={t("panels.governance.upgradeAuthority")}
                  value={
                    p.upgradeAuthority.authority ? (
                      <span className="break-all font-mono text-xs">{p.upgradeAuthority.authority}</span>
                    ) : (
                      <span className="text-muted-foreground">
                        {p.upgradeAuthority.note ?? t("panels.governance.frozen")}
                      </span>
                    )
                  }
                  mono
                />
                {p.upgradeAuthority.programData && (
                  <Row label={t("panels.governance.programData")} value={p.upgradeAuthority.programData} mono />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {data.poolState && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4 text-[#00E676]" />
              {t("panels.governance.poolState")}
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border/60 text-sm">
            <Row label="PoolAddress" value={data.poolState.poolAddress} mono />
            <Row label="NAV" value={data.poolState.nav} mono />
            <Row label={t("panels.governance.paused")} value={data.poolState.paused ? "✓" : "-"} />
            <Row label={t("panels.governance.pendingAdmin")} value={data.poolState.pendingAdmin ?? "-"} mono />
            <Row label={t("panels.governance.adminDelay")} value={data.poolState.pendingAdminDelaySecs} mono />
            <Row label={t("panels.governance.feeApy")} value={data.poolState.feeApyBps} mono />
            <Row
              label={t("panels.governance.shares")}
              value={`${data.poolState.lpShareBps} / ${data.poolState.platformShareBps} / ${data.poolState.rebateShareBps}`}
              mono
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("panels.governance.registry")}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border/60 text-sm">
          <Row
            label={t("panels.governance.initialized")}
            value={data.registry.initialized ? "✓" : t("panels.governance.notInitialized")}
          />
          {data.registry.registry && <Row label="Registry PDA" value={data.registry.registry} mono />}
          <Row label={t("panels.governance.registryAdmin")} value={data.registry.admin ?? data.registry.note ?? "-"} mono />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("panels.governance.deployment")}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border/60 text-sm">
          <Row label={t("panels.governance.multisig")} value={data.deployment.multisigAdmin ?? t("panels.governance.multisigMissing")} mono />
          <Row
            label={t("panels.governance.testDeployer")}
            value={
              data.deployment.testDeployer ? (
                <span className="break-all font-mono text-xs">{data.deployment.testDeployer}</span>
              ) : (
                "-"
              )
            }
          />
          <Row label={t("panels.governance.deployWallet")} value={data.deployment.deployWallet ?? "-"} mono />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{t("panels.governance.note")}</p>
    </div>
  );
}
