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

interface SkillListItem {
  id: string;
  name: string;
  description: string | null;
  status: "Active" | "Archived";
  versionCount: number;
  latestVersionNumber: number | null;
  triggerSummary: string | null;
  updatedAt: string;
}

interface WhereUsedSummary {
  consumers: Array<{ consumerId: string }>;
}

/**
 * Skills Library list (Target Architecture Blueprint Phase 5, BL-35, LLD §14.5.4).
 * Where-used counts are resolved per-row, client-side, after the initial list
 * paints — a deliberate N+1 (this is a low-traffic admin screen, same acceptance
 * `agent-platform`'s own `listAgentDefinitionsWithSummary` reasons about for its
 * two follow-up selects) rather than teaching the tenant-scoped `skills` module
 * about `agent-platform`'s `agent_version_skill` table, which would be a module
 * boundary violation (see the module allow-list's own comment).
 */
export function SkillsList({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [skills, setSkills] = useState<SkillListItem[] | null>(null);
  const [whereUsedCounts, setWhereUsedCounts] = useState<Record<string, number>>({});
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const result = await fetchJson<{ skills: SkillListItem[] }>("/api/v1/admin/skills");
    if (result.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    setSkills(result.data.skills ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!skills) return;
    for (const skill of skills) {
      fetchJson<WhereUsedSummary>(`/api/v1/admin/skills/${skill.id}/where-used`).then((r) => {
        if (r.kind === "ok") setWhereUsedCounts((prev) => ({ ...prev, [skill.id]: r.data.consumers.length }));
      });
    }
  }, [skills]);

  if (forbidden) return <AccessDeniedState moduleLabel="Agent Platform" />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Skills Library</h1>
        {canWrite && <Button onClick={() => router.push("/skills/new")}>+ New Skill</Button>}
      </div>

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

      {skills === null && !error ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" role="status" aria-label="Loading skills" />
          <Skeleton className="h-10 w-full" role="status" aria-label="Loading skills" />
        </div>
      ) : skills && skills.length === 0 ? (
        <div className="py-12 text-center">
          <p className="mb-4 text-muted-foreground">No skills yet</p>
          {canWrite && <Button onClick={() => router.push("/skills/new")}>+ New Skill</Button>}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Where used</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Last updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skills?.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <NextLink href={`/skills/${s.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    {s.name}
                  </NextLink>
                </TableCell>
                <TableCell>{s.latestVersionNumber !== null ? `v${s.latestVersionNumber}` : "—"}</TableCell>
                <TableCell>{whereUsedCounts[s.id] ?? "…"}</TableCell>
                <TableCell>
                  <span className="block max-w-[360px] truncate" title={s.triggerSummary ?? undefined}>
                    {s.triggerSummary ?? "—"}
                  </span>
                </TableCell>
                <TableCell>{new Date(s.updatedAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
