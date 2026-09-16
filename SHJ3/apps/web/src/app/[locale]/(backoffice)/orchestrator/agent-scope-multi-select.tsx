"use client";

/**
 * B4's "combine agents into the pipeline" control — only rendered while
 * `agentSelectionScope === "ExplicitList"` (`execution-mode-panel.tsx`). Writes
 * `RouterConfigs.agentScopeListJson`, the column `apps/ai`'s `filter_candidates_by_scope`
 * (`domain/orchestration.py`) now actually reads — before that fix this column was stored
 * but silently ignored by every execution mode, so this control would have been dishonest
 * UI wired to nothing.
 *
 * Sourced from the same Published-agents list `UpdateRouterConfig`'s own save-time
 * validation checks against (`ListAgents.execute({status:"Published"})`) — a stale/
 * unpublished id can never be *added* here, though `filter_candidates_by_scope` also
 * tolerates one going stale after being saved (see that function's own doc comment).
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";

export interface PublishedAgentOption {
  readonly id: string;
  readonly name: string;
}

export interface AgentScopeMultiSelectProps {
  /** The raw `agentScopeListJson` column value — `null` or a JSON array of agent ids. */
  readonly value: string | null;
  readonly onChange: (nextJson: string) => void;
  readonly agents: readonly PublishedAgentOption[];
}

function parseSelectedIds(value: string | null): ReadonlySet<string> {
  if (value === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function AgentScopeMultiSelect({
  value,
  onChange,
  agents,
}: AgentScopeMultiSelectProps): React.ReactElement {
  const t = useTranslations("orchestrator");
  const selectedIds = React.useMemo(() => parseSelectedIds(value), [value]);

  if (agents.length === 0) {
    return (
      <EmptyState
        headline={t("agentScopeList.emptyHeadline")}
        cause={t("agentScopeList.emptyCause")}
      />
    );
  }

  function toggle(agentId: string, checked: boolean): void {
    const next = new Set(selectedIds);
    if (checked) {
      next.add(agentId);
    } else {
      next.delete(agentId);
    }
    onChange(JSON.stringify([...next]));
  }

  return (
    <fieldset
      className="flex flex-col rounded-md border border-border p-3"
      style={{ gap: "var(--space-2)" }}
    >
      <legend className="px-1 text-xs font-medium text-muted-foreground">
        {t("agentScopeList.legend")}
      </legend>
      {agents.map((agent) => (
        <label key={agent.id} className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={selectedIds.has(agent.id)}
            onCheckedChange={(checked) => toggle(agent.id, checked === true)}
          />
          {agent.name}
        </label>
      ))}
    </fieldset>
  );
}
