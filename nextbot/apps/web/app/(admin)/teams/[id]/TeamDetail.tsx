"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Alert, AlertDescription, AlertTitle } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { AccessDeniedState, DelegationTree } from "@nextbot/ui";
import { toast } from "@nextbot/ui/lib/toast";
import type { DelegationTreeResponse, TeamVersionStatusValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface TeamView {
  id: string;
  name: string;
  description: string | null;
  status: string;
  currentVersionId: string | null;
}
interface VersionRow {
  id: string;
  version: number;
  status: TeamVersionStatusValue;
  sandboxRunId: string | null;
  createdAt: string;
}
interface VersionDetailView {
  version: VersionRow & { yaml: string; members: Array<{ memberKey: string; delegationTier: string; invokeWhen: string; fallbackAction: string }> };
  allowedTransitions: TeamVersionStatusValue[];
  sandboxCoverage: { runId: string; missingMemberKeys: string[] } | null;
}

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-11, LLD §14.7.5) — team
 * detail.
 *
 * The FR-ORC-11 gate is made VISIBLE rather than only enforced: the selected
 * version's sandbox coverage is shown as "which members were never exercised", and
 * a sandbox run renders its real delegation tree (Phase 6's `DelegationTree`,
 * against real `delegation_event` rows) so an approver can literally see that the
 * whole topology ran and not just the supervisor.
 */
export function TeamDetail({ teamId, canWrite }: { teamId: string; canWrite: boolean }) {
  const router = useRouter();
  const [team, setTeam] = useState<TeamView | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [selected, setSelected] = useState<VersionDetailView | null>(null);
  const [sandboxTask, setSandboxTask] = useState("I need a refund for last month's invoice.");
  const [sandboxTree, setSandboxTree] = useState<DelegationTreeResponse | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchJson<{ team: TeamView; versions: VersionRow[] }>(`/api/v1/admin/teams/${teamId}`);
    if (result.kind === "forbidden") return setForbidden(true);
    if (result.kind === "error") return setError(result.message);
    setTeam(result.data.team);
    setVersions(result.data.versions ?? []);
  }, [teamId]);

  const loadVersion = useCallback(
    async (versionId: string) => {
      const result = await fetchJson<VersionDetailView>(`/api/v1/admin/teams/${teamId}/versions/${versionId}`);
      if (result.kind !== "ok") return setError(result.kind === "forbidden" ? "Forbidden" : result.message);
      setSelected(result.data);
      setSandboxTree(null);
    },
    [teamId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function runSandbox() {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await fetchJson<{ agentRunId: string; tree: DelegationTreeResponse }>(
        `/api/v1/admin/teams/${teamId}/versions/${selected.version.id}/sandbox-run`,
        { method: "POST", body: JSON.stringify({ task: sandboxTask }) },
      );
      if (result.kind !== "ok") {
        setError(result.kind === "forbidden" ? "Forbidden" : result.message);
        return;
      }
      setSandboxTree(result.data.tree);
      toast.success("Sandbox run complete — the whole team topology was exercised.");
      await loadVersion(selected.version.id);
    } finally {
      setBusy(false);
    }
  }

  async function transition(to: TeamVersionStatusValue) {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await fetchJson(`/api/v1/admin/teams/${teamId}/versions/${selected.version.id}/transition`, {
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
  if (!team) return <Skeleton className="h-10 w-full" role="status" aria-label="Loading team" />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">{team.name}</h1>
        {canWrite && <Button onClick={() => router.push(`/teams/${teamId}/versions/new`)}>+ New version</Button>}
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

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Delegation tier</TableHead>
                <TableHead>Invoke when</TableHead>
                <TableHead>If unavailable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selected.version.members.map((m) => (
                <TableRow key={m.memberKey}>
                  <TableCell>{m.memberKey}</TableCell>
                  <TableCell>{m.delegationTier}</TableCell>
                  <TableCell>{m.invokeWhen}</TableCell>
                  <TableCell>{m.fallbackAction}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* FR-ORC-11 made visible: exactly which members a recorded sandbox run
              never exercised, before an approval is attempted. */}
          {selected.sandboxCoverage && selected.sandboxCoverage.missingMemberKeys.length > 0 && (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>Sandbox run did not exercise the whole team</AlertTitle>
              <AlertDescription>
                No delegation was traced for: {selected.sandboxCoverage.missingMemberKeys.join(", ")}. A supervisor-only run does
                not satisfy the promotion gate.
              </AlertDescription>
            </Alert>
          )}

          {canWrite && (
            <div className="mt-6">
              <Label htmlFor="sandbox-task">Sandbox task</Label>
              <Input id="sandbox-task" value={sandboxTask} onChange={(e) => setSandboxTask(e.target.value)} aria-describedby="sandbox-task-hint" />
              <FieldHint
                id="sandbox-task-hint"
                content="Runs the WHOLE team topology through the real delegation executor — every member, with the real permission evaluation, guardrail screen and PII re-mask at each hand-off."
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button onClick={() => void runSandbox()} disabled={busy}>
                  Run whole-team sandbox
                </Button>
                {selected.allowedTransitions.map((t) => (
                  <Button key={t} variant="outline" onClick={() => void transition(t)} disabled={busy}>
                    Move to {t}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {sandboxTree && (
            <div className="mt-6">
              <h3 className="font-heading mb-2 text-sm font-semibold">Delegation tree</h3>
              <DelegationTree roots={sandboxTree.roots} emptyMessage="No delegation occurred in this run." />
            </div>
          )}

          <pre className="bg-muted mt-6 overflow-auto p-3 font-mono text-xs">{selected.version.yaml}</pre>
        </section>
      )}
    </div>
  );
}
