"use client";

/**
 * B14 tab 4 — Privacy & data. `[rule]`: retention applies to transcripts and derived
 * memory; transaction records follow the statutory 7-year rule regardless of this
 * setting — this tab's retention `<Select>` never offers a transaction-retention option
 * at all (there is no such column to bind one to; `PrivacyConfigs` deliberately has none).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/patterns/data-table/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import {
  TRANSCRIPT_RETENTIONS,
  DATA_RESIDENCIES,
} from "../../../../modules/governance/domain/privacy.js";
import type { ErasureRequestRow } from "../../../../modules/governance/ports/erasure-request-repository.js";
import type { GetPrivacyConfigResult } from "../../../../modules/governance/application/get-privacy-config.js";
import type { GovernanceScreenActions } from "./governance-screen.js";

export interface PrivacyTabProps {
  readonly initialConfig: GetPrivacyConfigResult;
  readonly initialErasureRequests: readonly ErasureRequestRow[];
  readonly actions: GovernanceScreenActions;
}

export function PrivacyTab({
  initialConfig,
  initialErasureRequests,
  actions,
}: PrivacyTabProps): React.ReactElement {
  const t = useTranslations("governance.privacy");
  const router = useRouter();

  const [consentLedgerEnabled, setConsentLedgerEnabled] = React.useState(
    initialConfig.consentLedgerEnabled,
  );
  const [honourErasureRequests, setHonourErasureRequests] = React.useState(
    initialConfig.honourErasureRequests,
  );
  const [transcriptRetention, setTranscriptRetention] = React.useState(
    initialConfig.transcriptRetention,
  );
  const [dataResidency, setDataResidency] = React.useState(initialConfig.dataResidency);
  const [erasureRequests, setErasureRequests] = React.useState(initialErasureRequests);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function handleSave(): Promise<void> {
    setError(null);
    setSaved(false);
    setBusy(true);
    const result = await actions.updatePrivacyConfig({
      consentLedgerEnabled,
      honourErasureRequests,
      transcriptRetention,
      dataResidency,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  function handleReset(): void {
    setConsentLedgerEnabled(initialConfig.consentLedgerEnabled);
    setHonourErasureRequests(initialConfig.honourErasureRequests);
    setTranscriptRetention(initialConfig.transcriptRetention);
    setDataResidency(initialConfig.dataResidency);
    setSaved(false);
    setError(null);
  }

  async function handleProcessErasure(id: string): Promise<void> {
    setError(null);
    setBusy(true);
    const result = await actions.processErasureRequest(id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const refreshed = await actions.listErasureRequests();
    if (refreshed.ok) setErasureRequests(refreshed.value);
  }

  async function handleRunRetentionSweep(): Promise<void> {
    setError(null);
    setBusy(true);
    const result = await actions.runRetentionSweep();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  const erasureColumns = React.useMemo<ColumnDef<ErasureRequestRow, unknown>[]>(
    () => [
      {
        id: "subjectKind",
        accessorKey: "subjectKind",
        header: t("columnSubjectKind"),
        meta: { identifying: true },
      },
      { id: "receivedVia", accessorKey: "receivedVia", header: t("columnReceivedVia") },
      { id: "status", accessorKey: "status", header: t("columnStatus") },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-6">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      {saved ? <InlineAlert variant="success">{t("savedNote")}</InlineAlert> : null}

      <Card className="flex flex-col gap-4 p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("heading")}</h2>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground">{t("consentLedgerLabel")}</span>
          <Switch
            checked={consentLedgerEnabled}
            onCheckedChange={setConsentLedgerEnabled}
            aria-label={t("consentLedgerLabel")}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground">{t("honourErasureLabel")}</span>
          <Switch
            checked={honourErasureRequests}
            onCheckedChange={setHonourErasureRequests}
            aria-label={t("honourErasureLabel")}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm text-foreground" id="transcript-retention-label">
            {t("retentionLabel")}
          </label>
          <Select
            value={transcriptRetention}
            onValueChange={(value) => setTranscriptRetention(value as typeof transcriptRetention)}
          >
            <SelectTrigger aria-labelledby="transcript-retention-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRANSCRIPT_RETENTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`retentionOption.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("statutoryCarveOutNote")}</p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm text-foreground" id="data-residency-label">
            {t("residencyLabel")}
          </label>
          <Select
            value={dataResidency}
            onValueChange={(value) => setDataResidency(value as typeof dataResidency)}
          >
            <SelectTrigger aria-labelledby="data-residency-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATA_RESIDENCIES.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`residencyOption.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={handleReset} disabled={busy}>
            {t("resetAction")}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={busy}>
            {t("saveAction")}
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{t("retentionSweepHeading")}</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void handleRunRetentionSweep()}
          >
            {t("runSweepAction")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("retentionSweepNote")}</p>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("erasureHeading")}</h2>
        <DataTable<ErasureRequestRow>
          columns={erasureColumns}
          data={erasureRequests}
          getRowId={(row) => row.id}
          caption={t("erasureCaption")}
          status={erasureRequests.length === 0 ? "empty" : "ready"}
          emptyContent={
            <EmptyState headline={t("erasureEmptyHeadline")} cause={t("erasureEmptyCause")} />
          }
          renderRowActions={(row) =>
            row.status === "Received" || row.status === "InProgress" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void handleProcessErasure(row.id)}
              >
                {t("processErasureAction")}
              </Button>
            ) : null
          }
        />
      </Card>
    </div>
  );
}
