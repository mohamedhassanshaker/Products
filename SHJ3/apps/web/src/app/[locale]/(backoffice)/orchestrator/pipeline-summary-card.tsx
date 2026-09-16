"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { RouterConfigRow } from "../../../../modules/orchestration/ports/router-config-repository.js";

export interface PipelineSummaryCardProps {
  locale: string;
  routerConfig: RouterConfigRow | null;
}

/**
 * `/orchestrator`'s own first section — the Pipeline Designer's entry point, and the
 * "which supersedes which" fact this coexistence design settles on: when
 * `activePipelineVersionId` is set, that pipeline drives every real turn instead of
 * `executionMode`/`agentSelectionScope`/`agentScopeListJson` below (`ExecutionModePanel`'s
 * own disabled-with-`InlineAlert` state for those three controls says the same thing from
 * the other side).
 */
export function PipelineSummaryCard({
  locale,
  routerConfig,
}: PipelineSummaryCardProps): React.ReactElement {
  const t = useTranslations("orchestrator.pipeline.summaryCard");
  const active = routerConfig?.activePipelineVersionId ?? null;

  return (
    <div
      data-slot="pipeline-summary-card"
      className="flex items-center justify-between border border-border bg-card"
      style={{ borderRadius: "var(--radius-md)", padding: "var(--space-3)" }}
    >
      <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
        <span className="text-sm font-medium text-foreground">{t("heading")}</span>
        {active ? (
          <Badge variant="info" label={t("activeBadge")} />
        ) : (
          <Badge variant="neutral" label={t("noneActiveBadge")} />
        )}
      </div>
      <Button asChild variant="ghost">
        <Link href={`/${locale}/orchestrator/pipelines`}>{t("openDesignerAction")}</Link>
      </Button>
    </div>
  );
}
