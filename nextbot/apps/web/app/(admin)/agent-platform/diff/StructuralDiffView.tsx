"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Button } from "@nextbot/ui/components/ui/button";
import { fetchJson } from "@/src/lib/fetch-json";

interface StructuralChange {
  op: "added" | "removed" | "changed" | "moved";
  path: string;
  before?: unknown;
  after?: unknown;
  securityRelevant: boolean;
}

const OP_LABEL: Record<StructuralChange["op"], string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  moved: "Moved",
};

function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * ADR-0016 — the Git-independent structural-diff view (FR-AGT-19, BL-31). Works for
 * every version, connected to Git or not — the sibling `DiffView` (the real
 * Git-provider compare-API diff, ADR-0009) is presented as an *enriched* view
 * alongside this one, never blended into it. Security-relevant changes (tool grants,
 * approval tiers, guardrail policy, model route pins) render first and carry a
 * distinct badge, per ADR-0016 §2.1's review-surface requirement.
 */
export function StructuralDiffView({ versionAId, versionBId }: { versionAId: string; versionBId: string }) {
  const [changes, setChanges] = useState<StructuralChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setChanges(null);
    const result = await fetchJson<{ changes: StructuralChange[] }>(
      `/api/v1/admin/agent-platform/versions/structural-diff?a=${versionAId}&b=${versionBId}`,
    );
    if (result.kind === "ok") setChanges(result.data.changes);
    else setError(result.message);
  }

  useEffect(() => {
    void load();
  }, [versionAId, versionBId]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center gap-4">
          {error}
          <Button size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (changes === null) return <Skeleton className="h-[300px] w-full" role="status" aria-label="Loading structural diff" />;

  if (changes.length === 0) return <p>No structural differences between these two versions.</p>;

  return (
    <div>
      <p aria-live="polite" className="mb-4 font-medium">
        {changes.length} field{changes.length === 1 ? "" : "s"} changed
      </p>
      <ul role="list" className="flex flex-col gap-2">
        {changes.map((change, idx) => (
          <li
            role="listitem"
            key={`${change.path}-${idx}`}
            className="flex flex-col gap-1 rounded-none border p-3 font-mono text-sm"
          >
            <div className="flex flex-wrap items-center gap-2 font-sans">
              <Badge variant="secondary">{OP_LABEL[change.op]}</Badge>
              {change.securityRelevant && <Badge className="bg-orange-800 text-white">Security-relevant</Badge>}
              <span className="font-mono">{change.path || "(root)"}</span>
            </div>
            {change.op !== "added" && (
              <div>
                <span className="sr-only">Before: </span>
                <span className="text-red-700 line-through">{formatValue(change.before)}</span>
              </div>
            )}
            {change.op !== "removed" && (
              <div>
                <span className="sr-only">After: </span>
                <span className="text-emerald-700">{formatValue(change.after)}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
