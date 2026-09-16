"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AGENT_SELECTION_SCOPES,
  CONFLICT_RESOLUTIONS,
  EXECUTION_MODES,
  MERGE_POLICIES,
  ROUTING_STRATEGIES,
  type AgentSelectionScope,
  type ConflictResolution,
  type ExecutionMode,
  type MergePolicy,
  type RoutingStrategy,
} from "../../../../modules/orchestration/domain/router-config-vocabulary.js";
import type { RouterConfigRow } from "../../../../modules/orchestration/ports/router-config-repository.js";
import { AgentScopeMultiSelect, type PublishedAgentOption } from "./agent-scope-multi-select.js";
import type { updateRouterConfigAction } from "./actions.js";

export interface ExecutionModePanelActions {
  readonly updateRouterConfig: typeof updateRouterConfigAction;
}

export interface ExecutionModePanelProps {
  readonly locale: string;
  readonly routerConfig: RouterConfigRow | null;
  readonly publishedAgents: readonly PublishedAgentOption[];
  readonly actions: ExecutionModePanelActions;
}

const NONE_FALLBACK_AGENT = "__none__";

interface FormValues {
  readonly executionMode: ExecutionMode;
  readonly routingStrategy: RoutingStrategy;
  readonly agentSelectionScope: AgentSelectionScope;
  readonly agentScopeListJson: string | null;
  readonly maxHops: number;
  readonly maxLoopIterations: number;
  readonly costCeilingTokens: number;
  readonly costCeilingMicroAed: number;
  readonly conflictResolution: ConflictResolution;
  readonly responseMergePolicy: MergePolicy;
  readonly fallbackAgentId: string | null;
  readonly minRoutingConfidence: number;
}

function toFormValues(config: RouterConfigRow): FormValues {
  return {
    executionMode: config.executionMode,
    routingStrategy: config.routingStrategy,
    agentSelectionScope: config.agentSelectionScope,
    agentScopeListJson: config.agentScopeListJson,
    maxHops: config.maxHops,
    maxLoopIterations: config.maxLoopIterations,
    costCeilingTokens: config.costCeilingTokens,
    costCeilingMicroAed: config.costCeilingMicroAed,
    conflictResolution: config.conflictResolution,
    responseMergePolicy: config.responseMergePolicy,
    fallbackAgentId: config.fallbackAgentId,
    minRoutingConfidence: config.minRoutingConfidence,
  };
}

/**
 * B4's "Execution modes [click]" — the real, editable `RouterConfigs` singleton, plus a
 * plain-language explanation of what each of the three real modes means and when
 * `ProcessTurn` uses it (`docs/SHJ3-wireframes-guide.md` §B4's own table, rewritten to
 * describe real behaviour rather than a fixed demo prompt).
 *
 * The three mode buttons still only switch which mode's explanation is *displayed* — the
 * tenant's real, currently-*saved* mode is always badged as such, independent of which
 * mode's description is being read, and independent of whatever the form below currently
 * holds unsaved. Saving the form is the only way `executionMode` (or any other field here)
 * actually changes what `ProcessTurn` does — this used to be a deliberately read-only panel
 * (see `page.tsx`'s doc comment on why that changed); the form below replaces the old
 * read-only `<dl>` one field at a time, same layout.
 *
 * Client-side numeric ranges below mirror the real `CK_RouterConfigs_*` constraints
 * (`prisma/sql/001_constraints.sql`) purely for immediate feedback — `UpdateRouterConfig`
 * (the server-side use case `updateRouterConfigAction` wraps) remains the actual source of
 * truth and re-validates every one of them.
 */
export function ExecutionModePanel({
  locale,
  routerConfig,
  publishedAgents,
  actions,
}: ExecutionModePanelProps): React.ReactElement {
  const t = useTranslations("orchestrator");
  const router = useRouter();
  // Supersedes `executionMode`/`agentSelectionScope`/`agentScopeListJson` below — the same
  // coexistence rule `PipelineSummaryCard` states from the other side. The pointer lives on
  // this exact `RouterConfigRow`, so no extra data fetch is needed to know it.
  const isPipelineActive = routerConfig?.activePipelineVersionId != null;

  const [viewedMode, setViewedMode] = React.useState<ExecutionMode>(
    routerConfig?.executionMode ?? "Sequential",
  );
  const [form, setForm] = React.useState<FormValues | null>(
    routerConfig ? toFormValues(routerConfig) : null,
  );
  const [pendingSave, setPendingSave] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    setForm(routerConfig ? toFormValues(routerConfig) : null);
  }, [routerConfig]);

  function patch(next: Partial<FormValues>): void {
    setForm((prev) => (prev === null ? prev : { ...prev, ...next }));
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (form === null) return;
    setPendingSave(true);
    setError(null);
    setNotice(null);
    const result = await actions.updateRouterConfig(form);
    setPendingSave(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(t(`saveError.${result.value.reason}`));
      return;
    }
    setNotice(t("configPanel.savedNotice"));
    router.refresh();
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">{t("modes.heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("modes.body")}</p>
      </div>

      <div
        role="group"
        aria-label={t("modes.toggleGroupLabel")}
        className="flex flex-wrap"
        style={{ gap: "var(--space-2)" }}
      >
        {EXECUTION_MODES.map((mode) => (
          <Button
            key={mode}
            type="button"
            variant={viewedMode === mode ? "primary" : "outline"}
            size="sm"
            aria-pressed={viewedMode === mode}
            onClick={() => setViewedMode(mode)}
          >
            {t(`modes.${mode}.label`)}
            {routerConfig?.executionMode === mode ? (
              <Badge variant="success" size="sm" label={t("modes.activeBadge")} />
            ) : null}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-2 text-sm text-foreground">
        <p>{t(`modes.${viewedMode}.description`)}</p>
        <p className="text-muted-foreground">{t(`modes.${viewedMode}.traceExample`)}</p>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-foreground">{t("configPanel.heading")}</h3>
        {form === null || routerConfig === null ? (
          <div className="mt-2">
            <EmptyState
              headline={t("configPanel.notConfiguredHeadline")}
              cause={t("configPanel.notConfiguredCause")}
            />
          </div>
        ) : (
          <form
            className="mt-2 flex flex-col gap-4"
            onSubmit={(event) => void handleSubmit(event)}
          >
            {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
            {notice ? <InlineAlert variant="success">{notice}</InlineAlert> : null}
            {isPipelineActive ? (
              <InlineAlert variant="info">
                {t("configPanel.pipelineSupersedesNotice")}{" "}
                <Link
                  href={`/${locale}/orchestrator/pipelines`}
                  className="underline underline-offset-4"
                >
                  {t("configPanel.pipelineSupersedesLinkText")}
                </Link>
              </InlineAlert>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label={t("configPanel.executionModeLabel")}>
                {(field) => (
                  <Select
                    value={form.executionMode}
                    disabled={isPipelineActive}
                    onValueChange={(value) => patch({ executionMode: value as ExecutionMode })}
                  >
                    <SelectTrigger {...field}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXECUTION_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {t(`modes.${mode}.label`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <FormField label={t("configPanel.routingStrategyLabel")}>
                {(field) => (
                  <Select
                    value={form.routingStrategy}
                    onValueChange={(value) => patch({ routingStrategy: value as RoutingStrategy })}
                  >
                    <SelectTrigger {...field}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROUTING_STRATEGIES.map((strategy) => (
                        <SelectItem key={strategy} value={strategy}>
                          {t(`vocabulary.routingStrategy.${strategy}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <FormField
                label={t("configPanel.agentSelectionScopeLabel")}
                help={
                  form.agentSelectionScope === "ChannelBound"
                    ? t("configPanel.agentSelectionScopeChannelBoundHelp")
                    : undefined
                }
              >
                {(field) => (
                  <Select
                    value={form.agentSelectionScope}
                    disabled={isPipelineActive}
                    onValueChange={(value) =>
                      patch({ agentSelectionScope: value as AgentSelectionScope })
                    }
                  >
                    <SelectTrigger {...field}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENT_SELECTION_SCOPES.map((scope) => (
                        <SelectItem key={scope} value={scope}>
                          {t(`vocabulary.agentSelectionScope.${scope}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <FormField label={t("configPanel.conflictResolutionLabel")}>
                {(field) => (
                  <Select
                    value={form.conflictResolution}
                    onValueChange={(value) =>
                      patch({ conflictResolution: value as ConflictResolution })
                    }
                  >
                    <SelectTrigger {...field}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONFLICT_RESOLUTIONS.map((resolution) => (
                        <SelectItem key={resolution} value={resolution}>
                          {t(`vocabulary.conflictResolution.${resolution}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <FormField label={t("configPanel.mergePolicyLabel")}>
                {(field) => (
                  <Select
                    value={form.responseMergePolicy}
                    onValueChange={(value) =>
                      patch({ responseMergePolicy: value as MergePolicy })
                    }
                  >
                    <SelectTrigger {...field}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MERGE_POLICIES.map((policy) => (
                        <SelectItem key={policy} value={policy}>
                          {t(`vocabulary.mergePolicy.${policy}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <FormField
                label={t("configPanel.fallbackAgentLabel")}
                help={t("configPanel.fallbackAgentHelp")}
              >
                {(field) => (
                  <Select
                    value={form.fallbackAgentId ?? NONE_FALLBACK_AGENT}
                    onValueChange={(value) =>
                      patch({ fallbackAgentId: value === NONE_FALLBACK_AGENT ? null : value })
                    }
                  >
                    <SelectTrigger {...field}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_FALLBACK_AGENT}>
                        {t("configPanel.noFallbackAgent")}
                      </SelectItem>
                      {publishedAgents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <FormField label={t("configPanel.maxHopsLabel")}>
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    dir="ltr"
                    variant="mono"
                    min={1}
                    max={10}
                    value={form.maxHops}
                    onChange={(event) => patch({ maxHops: Number(event.target.value) })}
                    required
                  />
                )}
              </FormField>

              <FormField label={t("configPanel.maxLoopIterationsLabel")}>
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    dir="ltr"
                    variant="mono"
                    min={1}
                    max={20}
                    value={form.maxLoopIterations}
                    onChange={(event) => patch({ maxLoopIterations: Number(event.target.value) })}
                    required
                  />
                )}
              </FormField>

              <FormField label={t("configPanel.costCeilingTokensLabel")}>
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    dir="ltr"
                    variant="mono"
                    min={1}
                    value={form.costCeilingTokens}
                    onChange={(event) => patch({ costCeilingTokens: Number(event.target.value) })}
                    required
                  />
                )}
              </FormField>

              <FormField label={t("configPanel.costCeilingMicroAedLabel")}>
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    dir="ltr"
                    variant="mono"
                    min={1}
                    value={form.costCeilingMicroAed}
                    onChange={(event) =>
                      patch({ costCeilingMicroAed: Number(event.target.value) })
                    }
                    required
                  />
                )}
              </FormField>

              <FormField label={t("configPanel.minRoutingConfidenceLabel")}>
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    dir="ltr"
                    variant="mono"
                    min={0}
                    max={1}
                    step={0.01}
                    value={form.minRoutingConfidence}
                    onChange={(event) =>
                      patch({ minRoutingConfidence: Number(event.target.value) })
                    }
                    required
                  />
                )}
              </FormField>
            </div>

            {form.agentSelectionScope === "ExplicitList" && !isPipelineActive ? (
              <AgentScopeMultiSelect
                value={form.agentScopeListJson}
                onChange={(json) => patch({ agentScopeListJson: json })}
                agents={publishedAgents}
              />
            ) : null}

            <div>
              <Button type="submit" loading={pendingSave}>
                {t("configPanel.saveAction")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
