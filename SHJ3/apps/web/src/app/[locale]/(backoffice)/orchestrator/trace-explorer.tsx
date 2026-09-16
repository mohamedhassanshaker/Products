"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  DiffTraceViewer,
  type TraceStep as DiffTraceStep,
  type TraceStepStatus as DiffTraceStepStatus,
} from "@/components/patterns/diff-trace-viewer";
import type { TraceStepStatus } from "../../../../modules/orchestration/domain/router-config-vocabulary.js";
import type {
  OrchestrationTraceDetail,
  OrchestrationTraceStepRow,
  OrchestrationTraceSummaryRow,
} from "../../../../modules/orchestration/ports/orchestration-trace-repository.js";
import type { getTraceDetailAction } from "./actions.js";

export interface TraceExplorerActions {
  readonly getTraceDetail: typeof getTraceDetailAction;
}

export interface TraceExplorerProps {
  readonly recentTraces: readonly OrchestrationTraceSummaryRow[];
  readonly actions: TraceExplorerActions;
  /** Lifted so the sibling `RoutingPipelineDiagram` above this section can also reflect the
   *  currently selected real trace — this component owns the fetch, the parent owns which
   *  trace is "current" for both surfaces (§ "the diagram... updates once a trace is
   *  selected" judgment call, documented in the final report). */
  onTraceSelected: (trace: OrchestrationTraceDetail | null) => void;
}

const STEP_STATUS_TO_DIFF_STATUS: Record<TraceStepStatus, DiffTraceStepStatus> = {
  Ok: "success",
  Failed: "error",
  Timeout: "error",
  Blocked: "warning",
  Skipped: "pending",
};

function stepPayload(step: OrchestrationTraceStepRow): string | undefined {
  const payload: Record<string, unknown> = {};
  if (step.argumentsMasked) {
    try {
      payload.argumentsMasked = JSON.parse(step.argumentsMasked);
    } catch {
      payload.argumentsMasked = step.argumentsMasked;
    }
  }
  if (step.resultSummary) payload.resultSummary = step.resultSummary;
  if (step.errorCode) payload.errorCode = step.errorCode;
  return Object.keys(payload).length > 0 ? JSON.stringify(payload, null, 2) : undefined;
}

/**
 * B4's execution trace — the picker (a real `DataTable` over `ListRecentTraces`'s rows,
 * §12.3 `no-table-outside-datatable`) plus the selected trace's full detail, rendered
 * through the existing `DiffTraceViewer` `variant="orchestration"` organism
 * (`components/patterns/diff-trace-viewer`) rather than a bespoke renderer — that variant
 * already clusters steps sharing a `parallelGroup` into a fan-out/fan-in visual, which is
 * exactly what a Parallel/SupervisorWorker trace's real secondary `AgentInvoke` steps need.
 */
export function TraceExplorer({
  recentTraces,
  actions,
  onTraceSelected,
}: TraceExplorerProps): React.ReactElement {
  const t = useTranslations("orchestrator");

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<OrchestrationTraceDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Auto-select the most recent real trace on first load, so an admin opening this screen
  // with real data already present does not see the routing-pipeline diagram sitting empty —
  // `recentTraces` is already ordered newest-first (`listRecent`'s own `orderBy: { startedAt:
  // "desc" }`), so index 0 is exactly "the most recent". Runs once: gated on `selectedId`
  // being still `null`, not on `recentTraces` itself, so it never re-fires and stomps a
  // user's own later selection when `recentTraces` reference-changes on an unrelated re-render.
  // No react-hooks lint plugin is wired in this project (combobox.tsx's identical note —
  // referencing `react-hooks/exhaustive-deps` in a disable comment itself fails eslint with
  // "rule was not found"), so no suppression is needed for this intentionally-partial
  // dependency list: `handleSelect` is a plain function recreated every render, and this
  // effect must NOT re-fire on every one of those recreations, only when `recentTraces`
  // itself changes — the `autoSelectedRef` guard is what keeps it to "once per mount"
  // regardless.
  const autoSelectedRef = React.useRef(false);
  React.useEffect(() => {
    if (autoSelectedRef.current) return;
    if (recentTraces.length === 0) return;
    autoSelectedRef.current = true;
    void handleSelect(recentTraces[0]!.id);
  }, [recentTraces]);

  async function handleSelect(traceId: string): Promise<void> {
    setSelectedId(traceId);
    setError(null);
    setLoading(true);
    const result = await actions.getTraceDetail(traceId);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setDetail(null);
      onTraceSelected(null);
      return;
    }
    setDetail(result.value);
    onTraceSelected(result.value);
  }

  const columns = React.useMemo<ColumnDef<OrchestrationTraceSummaryRow, unknown>[]>(
    () => [
      {
        id: "startedAt",
        accessorKey: "startedAt",
        header: t("traceExplorer.columnStartedAt"),
        meta: { identifying: true, mono: true },
        cell: ({ row }) => (
          <Button
            variant="link"
            size="sm"
            aria-current={selectedId === row.original.id ? "true" : undefined}
            className={selectedId === row.original.id ? "font-semibold" : undefined}
            onClick={() => void handleSelect(row.original.id)}
          >
            {row.original.startedAt.toLocaleString()}
          </Button>
        ),
      },
      {
        id: "channelKey",
        accessorKey: "channelKey",
        header: t("traceExplorer.columnChannel"),
      },
      {
        id: "executionMode",
        accessorKey: "executionMode",
        header: t("traceExplorer.columnExecutionMode"),
        cell: ({ row }) => t(`modes.${row.original.executionMode}.label`),
      },
      {
        id: "routedAgentName",
        accessorKey: "routedAgentName",
        header: t("traceExplorer.columnRoutedAgent"),
        cell: ({ row }) => row.original.routedAgentName ?? t("traceExplorer.noAgent"),
      },
      {
        id: "routingConfidence",
        accessorKey: "routingConfidence",
        header: t("traceExplorer.columnConfidence"),
        meta: { mono: true },
        cell: ({ row }) =>
          row.original.routingConfidence === null ? "—" : row.original.routingConfidence.toFixed(2),
      },
      {
        id: "guardrails",
        header: t("traceExplorer.columnGuardrails"),
        cell: ({ row }) =>
          `${t(`vocabulary.guardrailResult.${row.original.guardrailPreResult}`)} → ${t(
            `vocabulary.guardrailResult.${row.original.guardrailPostResult}`,
          )}`,
      },
      {
        id: "durationMs",
        accessorKey: "durationMs",
        header: t("traceExplorer.columnDuration"),
        meta: { mono: true },
        cell: ({ row }) => `${row.original.durationMs} ms`,
      },
    ],
    [t, selectedId],
  );

  const diffSteps = React.useMemo<readonly DiffTraceStep[]>(() => {
    if (!detail) return [];
    return detail.steps.map((step) => {
      const payload = stepPayload(step);
      return {
        id: step.id,
        primaryLine: `${t(`vocabulary.traceStepKind.${step.kind}`)} — ${step.agentName ?? step.label}`,
        ...(step.confidence !== null ? { confidence: step.confidence } : {}),
        durationMs: step.durationMs,
        status: STEP_STATUS_TO_DIFF_STATUS[step.status],
        ...(payload !== undefined ? { payload } : {}),
        ...(step.kind === "AgentInvoke" && step.isSecondaryAgent
          ? { parallelGroup: "secondary-agents" }
          : {}),
      };
    });
  }, [detail, t]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div className="flex flex-col gap-3 lg:col-span-2">
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-base font-semibold text-foreground">{t("traceExplorer.heading")}</h2>
          {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
          <DataTable<OrchestrationTraceSummaryRow>
            columns={columns}
            data={recentTraces}
            getRowId={(row) => row.id}
            caption={t("traceExplorer.tableCaption")}
            status={recentTraces.length === 0 ? "empty" : "ready"}
            emptyContent={
              <EmptyState
                headline={t("traceExplorer.emptyHeadline")}
                cause={t("traceExplorer.emptyCause")}
              />
            }
          />
        </Card>
      </div>

      <div className="lg:col-span-3">
        {loading ? (
          <Card className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
            {t("traceExplorer.loadingDetail")}
          </Card>
        ) : detail ? (
          <Card className="flex flex-col gap-4 p-4">
            <div
              className="flex flex-wrap items-center justify-between"
              style={{ gap: "var(--space-2)" }}
            >
              <h2 className="text-base font-semibold text-foreground">
                {t("traceExplorer.detailHeading")}
              </h2>
              <Badge
                variant={detail.guardrailPostResult === "Pass" ? "success" : "warning"}
                size="sm"
                label={t(`vocabulary.guardrailResult.${detail.guardrailPostResult}`)}
              />
            </div>

            <dl
              className="grid grid-cols-1 sm:grid-cols-2"
              style={{ rowGap: "var(--space-2)", columnGap: "var(--space-4)" }}
            >
              <DetailRow
                label={t("traceExplorer.routedAgentLabel")}
                value={detail.routedAgentName ?? t("traceExplorer.noAgent")}
              />
              <DetailRow
                label={t("traceExplorer.routingConfidenceLabel")}
                value={
                  detail.routingConfidence === null ? "—" : detail.routingConfidence.toFixed(2)
                }
                mono
              />
              <DetailRow
                label={t("traceExplorer.hopCountLabel")}
                value={String(detail.hopCount)}
                mono
              />
              <DetailRow
                label={t("traceExplorer.mergePolicyLabel")}
                value={
                  detail.mergePolicyApplied
                    ? t(`vocabulary.mergePolicy.${detail.mergePolicyApplied}`)
                    : "—"
                }
              />
              <DetailRow
                label={t("traceExplorer.groundingConfidenceLabel")}
                value={
                  detail.groundingConfidence === null ? "—" : detail.groundingConfidence.toFixed(2)
                }
                mono
              />
              <DetailRow
                label={t("traceExplorer.tokensLabel")}
                value={`${detail.totalInputTokens.toLocaleString()} / ${detail.totalOutputTokens.toLocaleString()}`}
                mono
              />
              <DetailRow
                label={t("traceExplorer.costLabel")}
                value={detail.totalCostMicroAed.toLocaleString()}
                mono
              />
              <DetailRow
                label={t("traceExplorer.guardrailPreLabel")}
                value={t(`vocabulary.guardrailResult.${detail.guardrailPreResult}`)}
              />
            </dl>

            {detail.promptTextMasked ? (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">{t("traceExplorer.promptLabel")}</p>
                <p className="rounded bg-muted p-2 text-sm text-foreground">
                  {detail.promptTextMasked}
                </p>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">{t("traceExplorer.responseLabel")}</p>
              <p className="rounded bg-muted p-2 text-sm text-foreground">
                {detail.responseTextMasked}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">{t("traceExplorer.stepsHeading")}</p>
              <DiffTraceViewer
                variant="orchestration"
                steps={diffSteps}
                aria-label={t("traceExplorer.traceAriaLabel")}
                fanOutLabel={t("traceExplorer.fanOutLabel")}
                showPayloadLabel={t("traceExplorer.showPayloadLabel")}
                hidePayloadLabel={t("traceExplorer.hidePayloadLabel")}
                emptyHeadline={t("traceExplorer.stepsEmptyHeadline")}
                emptyCause={t("traceExplorer.stepsEmptyCause")}
              />
            </div>

            {detail.citations.length > 0 ? (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">
                  {t("traceExplorer.citationsHeading")}
                </p>
                <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {detail.citations.map((citation) => (
                    <li key={citation.id} dir="ltr" style={{ unicodeBidi: "isolate" }}>
                      #{citation.rank} {citation.chunkId} — {citation.retrievedVia} (
                      {citation.hybridScore.toFixed(2)})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        ) : (
          <Card className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
            {t("traceExplorer.selectAPrompt")}
          </Card>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        dir={mono ? "ltr" : undefined}
        style={mono ? { unicodeBidi: "isolate" } : undefined}
        className={mono ? "font-mono text-sm text-foreground" : "text-sm text-foreground"}
      >
        {value}
      </dd>
    </div>
  );
}
