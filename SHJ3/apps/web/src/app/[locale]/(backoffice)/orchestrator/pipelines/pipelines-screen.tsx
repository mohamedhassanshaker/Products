"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { PipelineDesignRow } from "../../../../../modules/orchestration/ports/pipeline-repository.js";
import type { ActionResult } from "./actions.js";
import type { CreatePipelineResult } from "../../../../../modules/orchestration/application/create-pipeline.js";
import { CreatePipelineDialog } from "./create-pipeline-dialog.js";

export interface PipelinesScreenActions {
  readonly createPipeline: (input: {
    readonly name: string;
  }) => Promise<ActionResult<CreatePipelineResult>>;
}

export interface PipelinesScreenProps {
  locale: string;
  designs: readonly PipelineDesignRow[];
  actions: PipelinesScreenActions;
}

const STATUS_BADGE_VARIANT: Readonly<Record<PipelineDesignRow["status"], "neutral" | "success" | "warning">> = {
  Draft: "warning",
  Published: "success",
  Archived: "neutral",
};

/** The Pipeline Designer's own landing list — every non-deleted `PipelineDesign`, newest
 *  edit first (`ListPipelines`'s own ordering), each linking into its editor route
 *  (`[pipelineId]/page.tsx`). */
export function PipelinesScreen({
  locale,
  designs,
  actions,
}: PipelinesScreenProps): React.ReactElement {
  const t = useTranslations("orchestrator.pipeline");
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
      <div className="flex justify-end">
        <Button type="button" onClick={() => setDialogOpen(true)}>
          {t("newPipelineAction")}
        </Button>
      </div>

      {designs.length === 0 ? (
        <EmptyState variant="first-run" headline={t("emptyHeadline")} cause={t("emptyCause")} />
      ) : (
        <ul className="flex flex-col" style={{ gap: "var(--space-2)" }}>
          {designs.map((design) => (
            <li key={design.id}>
              <Link
                href={`/${locale}/orchestrator/pipelines/${design.id}`}
                className={cn(
                  "flex items-center justify-between border border-border bg-card",
                  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
                )}
                style={{ borderRadius: "var(--radius-md)", padding: "var(--space-3)" }}
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">{design.name}</span>
                  {design.description ? (
                    <span className="text-xs text-muted-foreground">{design.description}</span>
                  ) : null}
                </span>
                <Badge variant={STATUS_BADGE_VARIANT[design.status]} label={design.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreatePipelineDialog
        locale={locale}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        createPipeline={actions.createPipeline}
      />
    </div>
  );
}
