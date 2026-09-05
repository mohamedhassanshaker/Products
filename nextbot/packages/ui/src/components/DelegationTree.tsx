import type { DelegationTreeNode, DelegationOutcomeValue } from "@nextbot/contracts";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { cn } from "@nextbot/ui/lib/utils";

/**
 * Target Architecture Blueprint Phase 6 (BL-37, ADR-0012, LLD §14.7) — the
 * delegation trace-tree's renderer, built ahead of the executor so Phase 14 had an
 * already-proven tree renderer to attach real data to. Renders whatever
 * `GET /api/v1/admin/agent-runs/{runId}/delegation-tree` returns.
 *
 * **Phase 14 (BL-46)**: that endpoint now returns REAL rows — the delegation
 * executor writes `delegation_event` for every hop — and this component is mounted
 * in two places (the Runtime Traces screen, FR-ORC-08, and the human takeover
 * panel, FR-ORC-06). `memberKey` is likewise populated for real now that
 * `team_member` exists.
 *
 * Admin-console-only surface (LLD §14.7.4/spec §9.5 item 4: delegation routing is
 * internal-only, never customer-facing) — `reason` is safe to render here
 * precisely because this component is never reachable from any customer-facing
 * widget/transcript surface.
 */

const OUTCOME_BADGE: Record<DelegationOutcomeValue, { variant?: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  Answered: { className: "bg-emerald-700 text-white" },
  NotMine: { variant: "secondary" },
  Escalated: { className: "bg-orange-800 text-white" },
  Failed: { variant: "destructive" },
  Denied: { variant: "destructive" },
  BudgetExceeded: { variant: "destructive" },
  FallbackUsed: { className: "bg-blue-700 text-white" },
  Timeout: { variant: "destructive" },
  // Phase 14 (BL-46, FR-ORC-04) — a Tier-2/Tier-3 delegation hop that suspended into
  // the Approval Queue. Deliberately NOT `destructive`: nothing went wrong, a human
  // is being asked to decide, so it reads as pending rather than as a failure.
  AwaitingApproval: { className: "bg-amber-700 text-white" },
};

export interface DelegationTreeProps {
  roots: DelegationTreeNode[];
  /** Shown when `roots` is empty — defaults to a copy explaining there is no
   * live delegation executor writing this table yet, which is accurate for
   * every run in this build. Overridable so Phase 14 can supply "no delegation
   * occurred in this run" once the executor exists. */
  emptyMessage?: string;
}

export function DelegationTree({ roots, emptyMessage }: DelegationTreeProps) {
  if (roots.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {emptyMessage ?? "No delegation events recorded for this run."}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1" role="tree" aria-label="Delegation tree">
      {roots.map((node) => (
        <DelegationTreeNodeItem key={node.delegationEventId} node={node} />
      ))}
    </ul>
  );
}

function DelegationTreeNodeItem({ node }: { node: DelegationTreeNode }) {
  const badge = OUTCOME_BADGE[node.outcome] ?? { variant: "secondary" as const };
  return (
    <li role="treeitem" aria-expanded={node.children.length > 0 ? true : undefined}>
      <div
        className={cn("flex flex-wrap items-center gap-2 rounded-none border border-border px-2 py-1 text-sm")}
        style={{ marginInlineStart: `${node.depth * 16}px` }}
      >
        <span className="font-medium">{node.agentLabel}</span>
        {node.memberKey && <span className="text-muted-foreground text-xs">({node.memberKey})</span>}
        <Badge variant={badge.variant} className={badge.className}>
          {node.outcome}
        </Badge>
        <span className="text-muted-foreground text-xs">{node.reason}</span>
        <span className="text-muted-foreground ms-auto text-xs">${Number(node.costUsd).toFixed(4)}</span>
        {node.latencyMs !== null && <span className="text-muted-foreground text-xs">{node.latencyMs}ms</span>}
      </div>
      {node.children.length > 0 && (
        <ul className="flex flex-col gap-1" role="group">
          {node.children.map((child) => (
            <DelegationTreeNodeItem key={child.delegationEventId} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}
