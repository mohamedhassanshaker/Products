"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PipelineVersionRow } from "../../../../../../modules/orchestration/ports/pipeline-repository.js";

const STATUS_BADGE_VARIANT: Readonly<Record<PipelineVersionRow["status"], "neutral" | "success" | "warning">> = {
  Draft: "warning",
  Published: "success",
  Archived: "neutral",
};

export interface PipelineVersionBarProps {
  version: PipelineVersionRow;
  isActive: boolean;
  canPublish: boolean;
  publishing?: boolean;
  activating?: boolean;
  onPublish: () => void;
  onSetActive: () => void;
  onClearActive: () => void;
  blockingFindingCount: number;
}

/** The editor's own top bar — version label/status, and the two real, audited acts a
 *  Published version can undergo: Publish (this Draft becomes the version's real,
 *  immutable state) and Activate/Deactivate (`RouterConfigs.activePipelineVersionId`,
 *  independent of publishing — a Published version is not automatically live). */
export function PipelineVersionBar({
  version,
  isActive,
  canPublish,
  publishing = false,
  activating = false,
  onPublish,
  onSetActive,
  onClearActive,
  blockingFindingCount,
}: PipelineVersionBarProps): React.ReactElement {
  const t = useTranslations("orchestrator.pipeline.versionBar");

  return (
    <div
      data-slot="pipeline-version-bar"
      className="flex flex-wrap items-center justify-between border border-border bg-card"
      style={{ borderRadius: "var(--radius-md)", padding: "var(--space-3)", gap: "var(--space-2)" }}
    >
      <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
        <span className="text-sm font-medium text-foreground">
          v{version.major}.{version.minor}
        </span>
        <Badge variant={STATUS_BADGE_VARIANT[version.status]} label={version.status} />
        {isActive ? <Badge variant="info" label={t("activeBadge")} /> : null}
      </div>
      <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
        {version.status === "Draft" && canPublish ? (
          <Button
            type="button"
            onClick={onPublish}
            disabled={publishing || blockingFindingCount > 0}
          >
            {publishing
              ? t("publishing")
              : blockingFindingCount > 0
                ? t("publishBlocked", { count: blockingFindingCount })
                : t("publishAction")}
          </Button>
        ) : null}
        {version.status === "Published" && canPublish ? (
          isActive ? (
            <Button type="button" variant="ghost" onClick={onClearActive} disabled={activating}>
              {activating ? t("deactivating") : t("deactivateAction")}
            </Button>
          ) : (
            <Button type="button" onClick={onSetActive} disabled={activating}>
              {activating ? t("activating") : t("activateAction")}
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
