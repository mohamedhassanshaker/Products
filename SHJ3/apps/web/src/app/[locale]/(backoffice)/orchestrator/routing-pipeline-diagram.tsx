"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { OrchestrationTraceDetail } from "../../../../modules/orchestration/ports/orchestration-trace-repository.js";

/**
 * Narrowed to only the two fields this component ever reads (`trace.steps` filtered to
 * `AgentInvoke` kind, needing `id`/`agentName`/`label`/`status` per step, and
 * `trace.mergePolicyApplied`) — confirmed by reading this component's own body, not
 * assumed. A purely widening change: every existing real-trace caller already satisfies
 * this narrower shape unchanged. This is what lets `trace-preview-panel.tsx` feed this same
 * diagram a synthetic trace built from a `PreviewTraceResult`, which has no real
 * `OrchestrationTraceDetail` id, conversation id, or persisted-trace fields to speak of.
 */
export type RoutingPipelineDiagramTrace = Pick<
  OrchestrationTraceDetail,
  "steps" | "mergePolicyApplied"
>;

export interface RoutingPipelineDiagramProps {
  /** The currently selected real trace, or a synthesized preview trace, or `null` before
   *  either exists — the structural shape (Prompt → Router → agent branches → Merge →
   *  Response) always renders; only the agent branches and the merge/response labels become
   *  real once a trace is selected (B4's diagram, `docs/SHJ3-wireframes-guide.md` §B4). */
  readonly trace: RoutingPipelineDiagramTrace | null;
}

const STEP_STATUS_BADGE_VARIANT: Record<string, BadgeProps["variant"]> = {
  Ok: "success",
  Failed: "destructive",
  Timeout: "destructive",
  Blocked: "warning",
  Skipped: "neutral",
};

/**
 * B4's routing pipeline diagram — a plain flex/grid layout (no canvas library; this is not
 * the Flow Designer's node canvas), built from real `OrchestrationTraceStep` rows once a
 * trace is selected. Agent branch nodes are every real `AgentInvoke` step in trace order
 * (primary and secondary alike), so a Sequential-mode trace (which `process_turn.py` never
 * invokes more than one agent for — confirmed by reading `execute()` directly: the
 * Sequential branch calls `invoke_agent` exactly once) renders a single branch node, while a
 * Parallel/SupervisorWorker trace's real fan-out renders as real multiple branches.
 */
export function RoutingPipelineDiagram({ trace }: RoutingPipelineDiagramProps): React.ReactElement {
  const t = useTranslations("orchestrator");

  const agentSteps = React.useMemo(
    () => trace?.steps.filter((step) => step.kind === "AgentInvoke") ?? [],
    [trace],
  );
  const mergePolicySubtitle = trace?.mergePolicyApplied
    ? t(`vocabulary.mergePolicy.${trace.mergePolicyApplied}`)
    : undefined;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">{t("diagram.heading")}</h2>
        <p className="text-sm text-muted-foreground">
          {trace ? t("diagram.selectedCaption") : t("diagram.placeholderCaption")}
        </p>
      </div>

      <div
        className="flex flex-col items-stretch md:flex-row md:items-center"
        style={{ gap: "var(--space-3)" }}
      >
        <DiagramNode hot label={t("diagram.promptNode")} />
        <DiagramArrow />
        <DiagramNode hot label={t("diagram.routerNode")} />
        <DiagramArrow />

        <div className="flex flex-1 flex-col" style={{ gap: "var(--space-2)" }}>
          {agentSteps.length > 0 ? (
            agentSteps.map((step) => (
              <DiagramNode
                key={step.id}
                label={step.agentName ?? step.label}
                badge={
                  <Badge
                    variant={STEP_STATUS_BADGE_VARIANT[step.status] ?? "neutral"}
                    size="sm"
                    label={t(`vocabulary.traceStepStatus.${step.status}`)}
                  />
                }
              />
            ))
          ) : (
            <DiagramNode muted label={t("diagram.noAgentBranches")} />
          )}
        </div>

        <DiagramArrow />
        <DiagramNode hot label={t("diagram.mergeNode")} subtitle={mergePolicySubtitle} />
        <DiagramArrow />
        <DiagramNode hot label={t("diagram.responseNode")} />
      </div>
    </Card>
  );
}

function DiagramArrow(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center self-center md:rotate-0"
    >
      <Icon icon={ArrowRight} size={16} className="text-muted-foreground rotate-90 md:rotate-0" />
    </div>
  );
}

function DiagramNode({
  label,
  subtitle,
  hot = false,
  muted = false,
  badge,
}: {
  readonly label: string;
  readonly subtitle?: string | undefined;
  readonly hot?: boolean;
  readonly muted?: boolean;
  readonly badge?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center border text-center",
        hot
          ? "border-primary bg-primary text-primary-foreground"
          : muted
            ? "border-dashed border-border text-muted-foreground"
            : "border-border bg-surface-sunken text-foreground",
      )}
      style={{
        borderRadius: "var(--radius-sm)",
        padding: "var(--space-2)",
        minBlockSize: "var(--table-row-height)",
      }}
    >
      <span className="text-sm font-medium">{label}</span>
      {subtitle ? <span className="text-2xs opacity-80">{subtitle}</span> : null}
      {badge}
    </div>
  );
}
