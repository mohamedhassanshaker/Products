"use client";

/** B13 tab 2 — Agent/Version/Set/Accuracy/Groundedness/Tool accuracy/Result, and
 *  **Run all suites**. Agent/version are shown by id (this screen resolves display names
 *  only where FR-EVAL-08's own blocked-publish message needs them — tab 3's summary
 *  strip; a full agent-name join here is a reasonable, deferred polish item, not a
 *  functional gap: every id shown is real and traceable). Built on `DataTable`
 *  (design-system.md §5.5 #41, `gate:table`). */
import * as React from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/patterns/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusCell } from "@/components/ui/status-cell";
import type { RegressionRunRow } from "../../../../modules/evaluation/ports/regression-run-repository.js";
import type { SuitePairing } from "../../../../modules/evaluation/application/run-all-suites.js";
import type { EvaluationScreenActions } from "./evaluation-screen.js";

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function resultStatus(run: RegressionRunRow): {
  label: string;
  family: "success" | "warning" | "destructive" | "neutral";
} {
  if (run.state !== "Completed") return { label: run.state, family: "neutral" };
  switch (run.result) {
    case "Passed":
      return { label: "Passed", family: "success" };
    case "Failed":
      return { label: "Failed", family: "destructive" };
    case "Error":
      return { label: "Error", family: "warning" };
    default:
      return { label: "—", family: "neutral" };
  }
}

/** FR-EVAL-06's own chosen interpretation (see `run-all-suites.ts`'s doc comment): every
 *  distinct pairing this tenant's regression history already contains. */
function derivePairings(runs: readonly RegressionRunRow[]): readonly SuitePairing[] {
  const seen = new Set<string>();
  const pairings: SuitePairing[] = [];
  for (const run of runs) {
    const key = `${run.goldenSetId}::${run.agentVersionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairings.push({
      goldenSetId: run.goldenSetId,
      agentId: run.agentId,
      agentVersionId: run.agentVersionId,
    });
  }
  return pairings;
}

export function RegressionRunsTab({
  regressionRuns,
  actions,
  onRunsRecorded,
}: {
  readonly regressionRuns: readonly RegressionRunRow[];
  readonly actions: EvaluationScreenActions;
  readonly onRunsRecorded: (runs: readonly RegressionRunRow[]) => void;
}) {
  const t = useTranslations("evaluation");
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pairings = React.useMemo(() => derivePairings(regressionRuns), [regressionRuns]);

  async function handleRunAll() {
    setRunning(true);
    setError(null);
    const outcomes = await actions.runAllSuites(pairings);
    setRunning(false);
    if (!outcomes.ok) {
      setError(outcomes.error);
      return;
    }
    const newRuns = outcomes.value
      .map((o) => o.result)
      .filter((r): r is Extract<(typeof outcomes.value)[number]["result"], { ok: true }> => r.ok)
      .map((r) => r.value);
    onRunsRecorded(newRuns);
  }

  const columns = React.useMemo<ColumnDef<RegressionRunRow, unknown>[]>(
    () => [
      {
        id: "agentId",
        accessorKey: "agentId",
        header: t("regressionRuns.columnAgent"),
        meta: { identifying: true, mono: true },
      },
      {
        id: "agentVersionId",
        accessorKey: "agentVersionId",
        header: t("regressionRuns.columnVersion"),
        meta: { mono: true },
      },
      {
        id: "goldenSetId",
        accessorKey: "goldenSetId",
        header: t("regressionRuns.columnSet"),
        meta: { mono: true },
      },
      {
        id: "accuracy",
        header: t("regressionRuns.columnAccuracy"),
        cell: ({ row }) => percent(row.original.accuracy),
      },
      {
        id: "groundedness",
        header: t("regressionRuns.columnGroundedness"),
        cell: ({ row }) => percent(row.original.groundedness),
      },
      {
        id: "toolAccuracy",
        header: t("regressionRuns.columnToolAccuracy"),
        cell: ({ row }) => percent(row.original.toolAccuracy),
      },
      {
        id: "result",
        header: t("regressionRuns.columnResult"),
        cell: ({ row }) => {
          const status = resultStatus(row.original);
          return <StatusCell label={status.label} family={status.family} rank={row.index} />;
        },
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("regressionRuns.description")}</p>
        <Button onClick={handleRunAll} loading={running} disabled={pairings.length === 0}>
          {t("regressionRuns.runAllSuites")}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive-strong">{error}</p> : null}
      <Card>
        <CardContent>
          <DataTable<RegressionRunRow>
            columns={columns}
            data={regressionRuns}
            getRowId={(row) => row.id}
            caption={t("regressionRuns.description")}
            captionVisuallyHidden
            status={regressionRuns.length === 0 ? "empty" : "ready"}
            emptyContent={
              <EmptyState
                headline={t("regressionRuns.emptyTitle")}
                cause={t("regressionRuns.emptyDescription")}
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
