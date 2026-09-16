"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { InlineAlert } from "@/components/ui/inline-alert";
import type {
  PipelineFindingReason,
  PipelineGraphFinding,
} from "../../../../../../modules/orchestration/domain/pipeline-graph.js";

/** Every real `PipelineFindingReason` -> its own `orchestrator.pipeline.findings.*`
 *  message key — an exhaustive `Record`, so a reason `analyzePipelineGraph` adds without a
 *  matching translation key fails to compile rather than silently falling back to the raw
 *  dotted reason string at runtime. */
const FINDING_MESSAGE_KEY: Readonly<Record<PipelineFindingReason, string>> = {
  "orchestration.pipeline.entry_node_required": "entryNodeRequired",
  "orchestration.pipeline.multiple_entry_nodes": "multipleEntryNodes",
  "orchestration.pipeline.terminal_node_required": "terminalNodeRequired",
  "orchestration.pipeline.orphan_node": "orphanNode",
  "orchestration.pipeline.cycle_outside_loop_edge": "cycleOutsideLoopEdge",
  "orchestration.pipeline.loop_edge_requires_max_iterations": "loopEdgeRequiresMaxIterations",
  "orchestration.pipeline.max_iterations_out_of_range": "maxIterationsOutOfRange",
  "orchestration.pipeline.loop_edge_does_not_close_a_loop": "loopEdgeDoesNotCloseALoop",
  "orchestration.pipeline.condition_on_non_loop_edge": "conditionOnNonLoopEdge",
  "orchestration.pipeline.condition_invalid": "conditionInvalid",
  "orchestration.pipeline.agent_not_published": "agentNotPublished",
  "orchestration.pipeline.self_loop_requires_loop_back_kind": "selfLoopRequiresLoopBackKind",
  "orchestration.pipeline.parallel_branches_do_not_converge": "parallelBranchesDoNotConverge",
  "orchestration.pipeline.parallel_fan_out_of_one": "parallelFanOutOfOne",
  "orchestration.pipeline.unconditional_loop": "unconditionalLoop",
  "orchestration.pipeline.duplicate_agent_in_pipeline": "duplicateAgentInPipeline",
};

export interface PipelineFindingsPanelProps {
  findings: readonly PipelineGraphFinding[];
  onSelectNode?: (nodeId: string) => void;
  onSelectEdge?: (edgeId: string) => void;
}

/**
 * Lists every blocking finding first (each clickable, focusing the offending node/edge),
 * then every advisory one — the same rule set `PublishPipelineVersion` gates on and the SQL
 * trigger enforces at the database, so a server-only failure (an agent unpublished by a
 * colleague seconds ago) renders through this exact same panel and message set.
 */
export function PipelineFindingsPanel({
  findings,
  onSelectNode,
  onSelectEdge,
}: PipelineFindingsPanelProps): React.ReactElement | null {
  const t = useTranslations("orchestrator.pipeline.findings");
  if (findings.length === 0) return null;

  const blocking = findings.filter((f) => f.severity === "blocking");
  const advisory = findings.filter((f) => f.severity === "advisory");

  function renderFinding(finding: PipelineGraphFinding, index: number) {
    const message = t(FINDING_MESSAGE_KEY[finding.reason]);
    const targetNodeId = finding.nodeIds[0];
    const targetEdgeId = finding.edgeIds[0];
    const clickable = (targetNodeId && onSelectNode) || (targetEdgeId && onSelectEdge);

    return (
      <InlineAlert
        key={`${finding.reason}-${index}`}
        variant={finding.severity === "blocking" ? "destructive" : "warning"}
      >
        {clickable ? (
          <button
            type="button"
            onClick={() => {
              if (targetNodeId && onSelectNode) onSelectNode(targetNodeId);
              else if (targetEdgeId && onSelectEdge) onSelectEdge(targetEdgeId);
            }}
            className="text-start underline-offset-4 hover:underline"
          >
            {message}
          </button>
        ) : (
          message
        )}
      </InlineAlert>
    );
  }

  return (
    <div
      data-slot="pipeline-findings-panel"
      className="flex flex-col"
      style={{ gap: "var(--space-2)" }}
    >
      {blocking.map(renderFinding)}
      {advisory.map((finding, index) => renderFinding(finding, blocking.length + index))}
    </div>
  );
}
