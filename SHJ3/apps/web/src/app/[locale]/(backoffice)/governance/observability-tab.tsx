"use client";

/** B14 tab 3 — Observability. The summary strip's exact degraded-service sentence names
 *  where the incident is handled (B5 tab 4's circuit breaker/fallback config), matching
 *  the wireframe's own worked example verbatim. */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { StatusCell, type StatusFamily } from "@/components/ui/status-cell";
import { DataTable } from "@/components/patterns/data-table/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import type { ServiceHealthSampleRow } from "../../../../modules/governance/ports/service-health-repository.js";
import type { GovernanceScreenActions } from "./governance-screen.js";

const STATUS_FAMILY: Readonly<Record<string, StatusFamily>> = {
  Healthy: "success",
  Degraded: "warning",
  Down: "destructive",
};
const STATUS_RANK: Readonly<Record<string, number>> = { Healthy: 0, Degraded: 1, Down: 2 };

export interface ObservabilityTabProps {
  readonly initialSamples: readonly ServiceHealthSampleRow[];
  readonly actions: GovernanceScreenActions;
}

export function ObservabilityTab({
  initialSamples,
  actions,
}: ObservabilityTabProps): React.ReactElement {
  const t = useTranslations("governance.observability");

  const [samples, setSamples] = React.useState(initialSamples);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setSamples(initialSamples), [initialSamples]);

  async function handleRecompute(): Promise<void> {
    setError(null);
    setBusy(true);
    const result = await actions.recomputeObservability();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSamples(result.value);
  }

  const degraded = samples.filter((sample) => sample.status === "Degraded");

  const columns = React.useMemo<ColumnDef<ServiceHealthSampleRow, unknown>[]>(
    () => [
      {
        id: "displayName",
        accessorKey: "displayName",
        header: t("columnService"),
        meta: { identifying: true },
      },
      {
        id: "p95LatencyMs",
        accessorKey: "p95LatencyMs",
        header: t("columnP95"),
        meta: { mono: true },
        cell: ({ row }) => t("msValue", { ms: row.original.p95LatencyMs }),
      },
      {
        id: "errorRate",
        accessorKey: "errorRate",
        header: t("columnErrorRate"),
        meta: { mono: true },
        cell: ({ row }) =>
          t("percentValue", { percent: Math.round(row.original.errorRate * 1000) / 10 }),
      },
      {
        id: "status",
        accessorKey: "status",
        header: t("columnStatus"),
        cell: ({ row }) => (
          <StatusCell
            family={STATUS_FAMILY[row.original.status] ?? "neutral"}
            label={row.original.status}
            rank={STATUS_RANK[row.original.status] ?? 99}
          />
        ),
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      {degraded.length > 0 ? (
        <InlineAlert variant="warning">
          {t("degradedSummary", {
            service: degraded[0]!.displayName,
            location: t("remediationLocation"),
          })}
        </InlineAlert>
      ) : null}

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{t("heading")}</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void handleRecompute()}
          >
            {t("recomputeAction")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("recomputeNote")}</p>
        <DataTable<ServiceHealthSampleRow>
          columns={columns}
          data={samples}
          getRowId={(row) => row.id}
          caption={t("caption")}
          status={samples.length === 0 ? "empty" : "ready"}
          emptyContent={<EmptyState headline={t("emptyHeadline")} cause={t("emptyCause")} />}
        />
      </Card>
    </div>
  );
}
