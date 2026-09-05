"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import yaml from "js-yaml";
import { Button } from "@nextbot/ui/components/ui/button";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { AccessDeniedState } from "@nextbot/ui";
import { toast } from "@nextbot/ui/lib/toast";
import type { WorkflowGraph, WorkflowVersionStatusValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface WorkflowView {
  id: string;
  name: string;
  description: string | null;
  status: string;
  currentVersionId: string | null;
}
interface VersionRow {
  id: string;
  version: number;
  status: WorkflowVersionStatusValue;
  sandboxRunId: string | null;
  createdAt: string;
}
interface VersionDetailView {
  version: VersionRow & { yaml: string };
  allowedTransitions: WorkflowVersionStatusValue[];
}

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.4) — workflow detail:
 * versions and the promotion ladder.
 *
 * **A read-only rendered graph view** (nodes + their outgoing edges, simply laid
 * out as a table rather than a visual canvas — the stretch goal this phase's own
 * brief allows, "a read-only rendered graph view ... is a reasonable stretch goal
 * if time allows") — the YAML-editor-plus-validation-panel (`WorkflowEditor`)
 * remains the required minimum authoring surface; this is purely an additional
 * read-side view over the same parsed artifact already in hand.
 *
 * No sandbox-run section (unlike `TeamDetail`'s FR-ORC-11 panel) — running a
 * workflow requires Phase 16's executor, which doesn't exist yet; every version
 * genuinely cannot progress past `HumanReview` in this build (see this module's
 * own `domain/promotion-policy.ts` doc comment), which the UI states plainly
 * rather than silently offering a dead-end action.
 */
export function WorkflowDetail({ workflowId, canWrite }: { workflowId: string; canWrite: boolean }) {
  const router = useRouter();
  const [workflow, setWorkflow] = useState<WorkflowView | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [selected, setSelected] = useState<VersionDetailView | null>(null);
  const [parsedGraph, setParsedGraph] = useState<WorkflowGraph | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchJson<{ workflow: WorkflowView; versions: VersionRow[] }>(`/api/v1/admin/workflows/${workflowId}`);
    if (result.kind === "forbidden") return setForbidden(true);
    if (result.kind === "error") return setError(result.message);
    setWorkflow(result.data.workflow);
    setVersions(result.data.versions ?? []);
  }, [workflowId]);

  const loadVersion = useCallback(
    async (versionId: string) => {
      const result = await fetchJson<VersionDetailView>(`/api/v1/admin/workflows/${workflowId}/versions/${versionId}`);
      if (result.kind !== "ok") return setError(result.kind === "forbidden" ? "Forbidden" : result.message);
      setSelected(result.data);
      try {
        setParsedGraph(yaml.load(result.data.version.yaml) as WorkflowGraph);
      } catch {
        setParsedGraph(null);
      }
    },
    [workflowId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function transition(to: WorkflowVersionStatusValue) {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await fetchJson(`/api/v1/admin/workflows/${workflowId}/versions/${selected.version.id}/transition`, {
        method: "POST",
        body: JSON.stringify({ to }),
      });
      if (result.kind !== "ok") {
        setError(result.kind === "forbidden" ? "Forbidden" : result.message);
        return;
      }
      toast.success(`Version moved to ${to}.`);
      await load();
      await loadVersion(selected.version.id);
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Agent Platform" />;
  if (!workflow) return <Skeleton className="h-10 w-full" role="status" aria-label="Loading workflow" />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">{workflow.name}</h1>
        {canWrite && <Button onClick={() => router.push(`/workflows/${workflowId}/versions/new`)}>+ New version</Button>}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Sandbox run</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {versions.map((v) => (
            <TableRow key={v.id}>
              <TableCell>v{v.version}</TableCell>
              <TableCell>{v.status}</TableCell>
              <TableCell>{v.sandboxRunId ? "Recorded" : "—"}</TableCell>
              <TableCell>{new Date(v.createdAt).toLocaleString()}</TableCell>
              <TableCell>
                <Button size="sm" variant="outline" onClick={() => void loadVersion(v.id)}>
                  Open
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {selected && (
        <section className="mt-8" aria-label={`Version ${selected.version.version} detail`}>
          <h2 className="font-heading mb-2 text-base font-semibold">v{selected.version.version}</h2>

          {selected.version.status === "HumanReview" && (
            <Alert className="mb-4">
              <AlertDescription>
                A workflow version cannot be promoted past HumanReview in this build — running it in the sandbox
                requires Phase 16&apos;s execution engine, which is a separate, later phase.
              </AlertDescription>
            </Alert>
          )}

          {parsedGraph && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Node id</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Outgoing edge(s)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsedGraph.spec.nodes.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell>{node.id}</TableCell>
                    <TableCell>{node.kind}</TableCell>
                    <TableCell>{describeOutgoingEdges(node)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {canWrite && (
            <div className="mt-6 flex flex-wrap gap-2">
              {selected.allowedTransitions.map((t) => (
                <Button key={t} variant="outline" onClick={() => void transition(t)} disabled={busy}>
                  Move to {t}
                </Button>
              ))}
              {selected.allowedTransitions.length === 0 && <p className="text-muted-foreground text-sm">No promotion is currently available for this version.</p>}
            </div>
          )}

          <pre className="bg-muted mt-6 overflow-auto p-3 font-mono text-xs">{selected.version.yaml}</pre>
        </section>
      )}
    </div>
  );
}

/** A plain-text summary of a node's own outgoing edge(s) — the read-only
 * rendered-graph stretch goal's own minimal "layout": no canvas, just a legible
 * per-node summary of where control flow goes next. */
function describeOutgoingEdges(node: WorkflowGraph["spec"]["nodes"][number]): string {
  switch (node.kind) {
    case "Router":
      return [...node.branches.map((b) => `${b.when ? `${b.when} -> ` : ""}${b.to}`), node.default ? `default -> ${node.default}` : "(no default!)"].join(", ");
    case "Parallel":
      return `branches: ${node.branches.join(", ")} -> join: ${node.joinNodeId}`;
    case "Join":
      return `-> ${node.next}`;
    case "Loop":
      return `body: ${node.bodyEntryNodeId}, exit -> ${node.next}`;
    case "HumanTask":
      return `-> ${node.next}${node.onReject ? `, onReject -> ${node.onReject}` : ""}`;
    case "End":
      return `(terminal: ${node.outcome})`;
    default:
      return "next" in node ? `-> ${node.next}` : "";
  }
}
