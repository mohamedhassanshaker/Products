"use client";

import { Fragment, useEffect, useState } from "react";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Button } from "@nextbot/ui/components/ui/button";
import { DelegationTree } from "@nextbot/ui";
import type { DelegationTreeResponse } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface DefinitionItem {
  id: string;
  name: string;
}
interface VersionItem {
  id: string;
  version: string;
}
interface AgentRunItem {
  id: string;
  status: string;
  trigger: string;
  costUsd: string | null;
  durationMs: number | null;
  startedAt: string;
  otelTraceId: string;
}

/** Status→Badge treatment (see `DefinitionDetail.tsx`'s `STATUS_BADGE` doc comment for
 * the same "solid, pre-verified pairing beyond the four built-in variants" convention). */
const STATUS_BADGE: Record<string, { variant?: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  Running: { className: "bg-blue-700 text-white" },
  Succeeded: { className: "bg-emerald-700 text-white" },
  Failed: { variant: "destructive" },
  PausedForApproval: { className: "bg-orange-800 text-white" },
  Cancelled: { variant: "secondary" },
  TimedOut: { variant: "destructive" },
};

/**
 * BL-07 Runtime Observability — basic run list (UX_GUIDELINES.md §6.7). Explicitly
 * **not** a trace timeline/span waterfall (Phase 13's job once the ClickHouse read
 * path exists) — this is a flat list of `agent_run` rows for a chosen version.
 *
 * **Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-08)**: each run row can now
 * expand its DELEGATION TREE, read from
 * `GET /api/v1/admin/agent-runs/{runId}/delegation-tree` (Phase 6's endpoint, which
 * this phase's executor is what finally populates). This is one of the two mount
 * points that turn Phase 6's `DelegationTree` component from a seeded-data
 * demonstration into a real observability surface; the other is the human takeover
 * panel (FR-ORC-06). A single-agent run simply renders the empty state — the tree is
 * additive to every existing row, never a change to what a non-team run shows.
 */
export function RuntimeTraces() {
  const [definitions, setDefinitions] = useState<DefinitionItem[] | null>(null);
  const [versions, setVersions] = useState<VersionItem[] | null>(null);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [runs, setRuns] = useState<AgentRunItem[] | null>(null);
  // FR-ORC-08 — the delegation tree for whichever run the operator expanded. Loaded
  // lazily, per run, so the run list itself costs exactly what it did before.
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [delegationTree, setDelegationTree] = useState<DelegationTreeResponse | null>(null);

  async function toggleDelegationTree(runId: string) {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      setDelegationTree(null);
      return;
    }
    setExpandedRunId(runId);
    setDelegationTree(null);
    const result = await fetchJson<DelegationTreeResponse>(`/api/v1/admin/agent-runs/${runId}/delegation-tree`);
    if (result.kind === "ok") setDelegationTree(result.data);
  }

  useEffect(() => {
    fetchJson<{ definitions: DefinitionItem[] }>("/api/v1/admin/agent-platform/definitions").then((r) => {
      if (r.kind === "ok") setDefinitions(r.data.definitions);
    });
  }, []);

  useEffect(() => {
    if (!selectedDefinitionId) {
      setVersions(null);
      return;
    }
    fetchJson<{ versions: VersionItem[] }>(`/api/v1/admin/agent-platform/definitions/${selectedDefinitionId}/versions`).then((r) => {
      if (r.kind === "ok") setVersions(r.data.versions);
    });
  }, [selectedDefinitionId]);

  useEffect(() => {
    if (!selectedVersionId) {
      setRuns(null);
      return;
    }
    fetchJson<{ runs: AgentRunItem[] }>(`/api/v1/admin/agent-platform/versions/${selectedVersionId}/runs`).then((r) => {
      if (r.kind === "ok") setRuns(r.data.runs ?? []);
    });
  }, [selectedVersionId]);

  return (
    <div>
      <h1 className="mb-6 font-heading text-lg font-semibold">Runtime Traces</h1>

      <div className="mb-6 flex gap-4">
        <div className="max-w-[280px]">
          <div className="mb-1 flex items-center gap-1">
            <Label htmlFor="runtime-traces-definition" className="text-sm">
              Agent definition
            </Label>
            <FieldHint
              id="runtime-traces-definition-hint"
              content="Which agent definition's runs to show below — selecting one loads its versions into the Version filter and clears any previously selected version."
            />
          </div>
          <Select
            value={selectedDefinitionId}
            onValueChange={(v) => {
              if (v === null) return;
              setSelectedDefinitionId(v);
              setSelectedVersionId("");
            }}
          >
            <SelectTrigger id="runtime-traces-definition" className="w-[280px]" aria-label="Agent definition">
              <SelectValue placeholder="Select an agent definition" />
            </SelectTrigger>
            <SelectContent>
              {definitions?.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {versions && (
          <div className="max-w-[200px]">
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="runtime-traces-version" className="text-sm">
                Version
              </Label>
              <FieldHint
                id="runtime-traces-version-hint"
                content="Which version of the selected agent definition's runs to show below — this list of agent_run rows is scoped to exactly this one version, not the definition as a whole."
              />
            </div>
            <Select value={selectedVersionId} onValueChange={(v) => v !== null && setSelectedVersionId(v)}>
              <SelectTrigger id="runtime-traces-version" className="w-[200px]" aria-label="Version">
                <SelectValue placeholder="Select a version" />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    v{v.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {!selectedVersionId ? (
        <p className="text-muted-foreground">Select an agent definition and version to view its runs.</p>
      ) : runs === null ? (
        <Skeleton className="h-[120px] w-full" role="status" aria-label="Loading runs" />
      ) : runs.length === 0 ? (
        <p className="text-muted-foreground">
          No agent runs recorded yet. Runs will appear here once eval executions and live conversations are wired through this observability path.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Trace ID</TableHead>
              <TableHead>Delegation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => {
              const statusBadge = STATUS_BADGE[r.status] ?? { variant: "secondary" as const };
              return (
                <Fragment key={r.id}>
                <TableRow>
                  <TableCell>
                    <Badge variant={statusBadge.variant} className={statusBadge.className}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{r.trigger}</TableCell>
                  <TableCell>{new Date(r.startedAt).toLocaleString()}</TableCell>
                  <TableCell>{r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}</TableCell>
                  <TableCell>{r.costUsd !== null ? `$${Number(r.costUsd).toFixed(4)}` : "—"}</TableCell>
                  <TableCell>
                    <code className="text-xs">{r.otelTraceId.slice(0, 12)}…</code>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-expanded={expandedRunId === r.id}
                      onClick={() => void toggleDelegationTree(r.id)}
                    >
                      {expandedRunId === r.id ? "Hide tree" : "Delegation tree"}
                    </Button>
                  </TableCell>
                </TableRow>
                {expandedRunId === r.id && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      {delegationTree === null ? (
                        <Skeleton className="h-10 w-full" role="status" aria-label="Loading delegation tree" />
                      ) : (
                        <DelegationTree
                          roots={delegationTree.roots}
                          emptyMessage="No delegation occurred in this run — a single agent handled it end to end."
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
