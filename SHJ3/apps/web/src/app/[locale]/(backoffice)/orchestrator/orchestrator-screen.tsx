"use client";

import * as React from "react";
import type { RouterConfigRow } from "../../../../modules/orchestration/ports/router-config-repository.js";
import type {
  OrchestrationTraceDetail,
  OrchestrationTraceSummaryRow,
} from "../../../../modules/orchestration/ports/orchestration-trace-repository.js";
import type { PublishedAgentOption } from "./agent-scope-multi-select.js";
import { PipelineSummaryCard } from "./pipeline-summary-card.js";
import { ExecutionModePanel } from "./execution-mode-panel.js";
import { RoutingPipelineDiagram } from "./routing-pipeline-diagram.js";
import { TraceExplorer, type TraceExplorerActions } from "./trace-explorer.js";
import { TracePreviewPanel } from "./trace-preview-panel.js";
import type { previewTraceAction, updateRouterConfigAction } from "./actions.js";

export interface OrchestratorScreenActions extends TraceExplorerActions {
  readonly updateRouterConfig: typeof updateRouterConfigAction;
  readonly previewTrace: typeof previewTraceAction;
}

export interface OrchestratorScreenProps {
  readonly locale: string;
  readonly routerConfig: RouterConfigRow | null;
  readonly recentTraces: readonly OrchestrationTraceSummaryRow[];
  readonly publishedAgents: readonly PublishedAgentOption[];
  readonly actions: OrchestratorScreenActions;
}

/**
 * `/orchestrator` in full (B4) — four real sections stacked, matching the wireframe's own
 * single-screen layout (`docs/shj3-wireframes.html#screen-orchestrator` has no sub-tabs):
 *
 *  1. `ExecutionModePanel` — the real, editable `RouterConfigs` singleton plus a
 *     plain-language explanation of all three execution modes.
 *  2. `RoutingPipelineDiagram` — the structural pipeline, enriched with the currently
 *     selected real trace's real agent branches and merge outcome once one is picked below.
 *  3. `TracePreviewPanel` — the live, no-cost, no-persistence "test a prompt" simulator
 *     against the currently *saved* `RouterConfigs` singleton above.
 *  4. `TraceExplorer` — the real picker + real per-step trace, sourced from
 *     `OrchestrationTraces`/`OrchestrationTraceSteps`/`GroundingCitations`.
 */
export function OrchestratorScreen({
  locale,
  routerConfig,
  recentTraces,
  publishedAgents,
  actions,
}: OrchestratorScreenProps): React.ReactElement {
  const [selectedTrace, setSelectedTrace] = React.useState<OrchestrationTraceDetail | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <PipelineSummaryCard locale={locale} routerConfig={routerConfig} />
      <ExecutionModePanel
        locale={locale}
        routerConfig={routerConfig}
        publishedAgents={publishedAgents}
        actions={{ updateRouterConfig: actions.updateRouterConfig }}
      />
      <RoutingPipelineDiagram trace={selectedTrace} />
      <TracePreviewPanel
        locale={locale}
        publishedAgents={publishedAgents}
        mergePolicyApplied={routerConfig?.responseMergePolicy ?? null}
        actions={{ previewTrace: actions.previewTrace }}
      />
      <TraceExplorer
        recentTraces={recentTraces}
        actions={actions}
        onTraceSelected={setSelectedTrace}
      />
    </div>
  );
}
