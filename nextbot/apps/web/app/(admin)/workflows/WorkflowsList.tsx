"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { AccessDeniedState } from "@nextbot/ui";
import { fetchJson } from "@/src/lib/fetch-json";

interface WorkflowListItem {
  id: string;
  name: string;
  description: string | null;
  status: "Active" | "Archived";
  currentVersionId: string | null;
  updatedAt: string;
}

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.4) — the Workflows
 * list. Mirrors `TeamsList`/`SkillsList` exactly (same load/forbidden/error
 * triple, same three render branches, same header shape) rather than inventing a
 * second list idiom for the same admin surface.
 */
export function WorkflowsList({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowListItem[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const result = await fetchJson<{ workflows: WorkflowListItem[] }>("/api/v1/admin/workflows");
    if (result.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    setWorkflows(result.data.workflows ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  if (forbidden) return <AccessDeniedState moduleLabel="Agent Platform" />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Workflows</h1>
        {canWrite && <Button onClick={() => router.push("/workflows/new")}>+ New Workflow</Button>}
      </div>

      <p className="text-muted-foreground mb-4 text-sm">
        A workflow is a versioned graph of triggers, agent/skill/tool steps, routers, human-in-the-loop tasks, and
        parallel/loop control flow. This screen authors and validates the static graph — running it is Phase 16's
        executor.
      </p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex items-center gap-4">
            {error}
            <Button size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {workflows === null && !error ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" role="status" aria-label="Loading workflows" />
          <Skeleton className="h-10 w-full" role="status" aria-label="Loading workflows" />
        </div>
      ) : workflows && workflows.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground mb-4">No workflows yet</p>
          {canWrite && <Button onClick={() => router.push("/workflows/new")}>+ New Workflow</Button>}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>In production</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Last updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workflows?.map((w) => (
              <TableRow key={w.id}>
                <TableCell>
                  <NextLink href={`/workflows/${w.id}`} className="text-primary font-medium underline-offset-4 hover:underline">
                    {w.name}
                  </NextLink>
                </TableCell>
                <TableCell>{w.status}</TableCell>
                <TableCell>{w.currentVersionId ? "Yes" : "No"}</TableCell>
                <TableCell>
                  <span className="block max-w-[360px] truncate" title={w.description ?? undefined}>
                    {w.description ?? "—"}
                  </span>
                </TableCell>
                <TableCell>{new Date(w.updatedAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
