"use client";

/**
 * B4's live "test a prompt" simulator — type a sample prompt, pick a primary agent, and see
 * exactly which agents the tenant's real, currently-*saved* `RouterConfig` would invoke and
 * how their replies would be merged, with no persisted conversation and no real cost
 * (`previewTraceAction` → `apps/ai`'s `POST /v1/orchestration/trace-preview`, whose own
 * module doc comment explains exactly how: an unconditional `DeterministicChatModel`, never
 * the environment-conditional real one, plus the same sandbox-only store/tool-invoker
 * `/v1/sandbox/turns` already established).
 *
 * "Currently *saved* config" is a deliberate, disclosed assumption (this panel's own
 * `mergePolicyApplied` prop is the loaded `RouterConfigRow.responseMergePolicy`, not
 * whatever unsaved edits might currently be sitting in `ExecutionModePanel`'s own form
 * state) — matching the brief's own wording of "what the current saved config would do."
 * Save the form first to preview its effect.
 *
 * Reuses `RoutingPipelineDiagram` for rendering — this is exactly why that component's
 * `trace` prop was narrowed to `RoutingPipelineDiagramTrace`
 * (`Pick<OrchestrationTraceDetail, "steps" | "mergePolicyApplied">`): a
 * `PreviewTraceResult` has no real persisted trace id/conversation id to synthesize, only
 * the two fields the diagram actually reads.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { OrchestrationTraceStepRow } from "../../../../modules/orchestration/ports/orchestration-trace-repository.js";
import type { PreviewTraceResult } from "../../../../modules/orchestration/ports/orchestration-preview-client.js";
import type { previewTraceAction } from "./actions.js";
import type { PublishedAgentOption } from "./agent-scope-multi-select.js";
import { RoutingPipelineDiagram, type RoutingPipelineDiagramTrace } from "./routing-pipeline-diagram.js";

export interface TracePreviewPanelActions {
  readonly previewTrace: typeof previewTraceAction;
}

export interface TracePreviewPanelProps {
  readonly locale: string;
  readonly publishedAgents: readonly PublishedAgentOption[];
  /** The currently loaded, currently *saved* `RouterConfigRow.responseMergePolicy` — see
   *  this file's own module doc comment for why it is never unsaved form state. `null`
   *  before a `RouterConfigs` singleton exists at all (the same case `ExecutionModePanel`
   *  itself renders as "not configured"), in which case the preview is not offered. */
  readonly mergePolicyApplied: string | null;
  readonly actions: TracePreviewPanelActions;
}

function stepsFromHops(
  hops: PreviewTraceResult["trace"]["hops"],
  agents: readonly PublishedAgentOption[],
): readonly OrchestrationTraceStepRow[] {
  const nameById = new Map(agents.map((agent) => [agent.id, agent.name]));
  return hops.map((hop) => ({
    id: `preview-${hop.ordinal}`,
    ordinal: hop.ordinal,
    kind: hop.kind as OrchestrationTraceStepRow["kind"],
    agentId: hop.agentId,
    agentName: hop.agentId !== null ? (nameById.get(hop.agentId) ?? hop.agentId) : null,
    toolBindingId: hop.toolBindingId,
    label: hop.label,
    argumentsMasked: null,
    resultSummary: null,
    confidence: hop.confidence,
    status: hop.status as OrchestrationTraceStepRow["status"],
    errorCode: hop.errorCode,
    isSecondaryAgent: hop.isSecondaryAgent,
    durationMs: hop.durationMs,
  }));
}

export function TracePreviewPanel({
  locale,
  publishedAgents,
  mergePolicyApplied,
  actions,
}: TracePreviewPanelProps): React.ReactElement {
  const t = useTranslations("orchestrator");

  const [primaryAgentId, setPrimaryAgentId] = React.useState(publishedAgents[0]?.id ?? "");
  const [content, setContent] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<PreviewTraceResult | null>(null);

  const diagramTrace: RoutingPipelineDiagramTrace | null = result
    ? { steps: stepsFromHops(result.trace.hops, publishedAgents), mergePolicyApplied }
    : null;

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (primaryAgentId === "" || content.trim().length === 0) return;
    setPending(true);
    setError(null);
    const outcome = await actions.previewTrace({ primaryAgentId, content, locale });
    setPending(false);
    if (!outcome.ok) {
      setError(outcome.error);
      setResult(null);
      return;
    }
    setResult(outcome.value);
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">{t("tracePreview.heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("tracePreview.body")}</p>
      </div>

      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      {publishedAgents.length === 0 ? (
        <EmptyState
          headline={t("tracePreview.noPublishedAgentsHeadline")}
          cause={t("tracePreview.noPublishedAgentsCause")}
        />
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)}>
          <FormField label={t("tracePreview.agentLabel")}>
            {(field) => (
              <Select value={primaryAgentId} onValueChange={setPrimaryAgentId}>
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {publishedAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label={t("tracePreview.promptLabel")}>
            {(field) => (
              <Textarea
                {...field}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={t("tracePreview.promptPlaceholder")}
                rows={3}
                required
              />
            )}
          </FormField>
          <div>
            <Button type="submit" loading={pending}>
              {t("tracePreview.runAction")}
            </Button>
          </div>
        </form>
      )}

      {result ? (
        <div className="flex flex-col gap-3">
          <InlineAlert variant="info">{t("tracePreview.resultCaption")}</InlineAlert>
          <RoutingPipelineDiagram trace={diagramTrace} />
          <div className="flex flex-col gap-1 text-sm text-foreground">
            <p>{result.message.content}</p>
            <p className="text-xs text-muted-foreground">
              {t("tracePreview.usageLabel", {
                tokensIn: result.usage.tokensIn,
                tokensOut: result.usage.tokensOut,
                cost: result.usage.costAed.toFixed(4),
              })}
            </p>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
