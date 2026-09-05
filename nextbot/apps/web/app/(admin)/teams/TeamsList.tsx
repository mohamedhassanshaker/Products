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

interface TeamListItem {
  id: string;
  name: string;
  description: string | null;
  status: "Active" | "Archived";
  currentVersionId: string | null;
  updatedAt: string;
}

/**
 * Target Architecture Blueprint Phase 14 (BL-46, LLD §14.7.5) — the Teams list.
 * Mirrors `SkillsList` exactly (same load/forbidden/error triple, same three render
 * branches, same header shape) rather than inventing a second list idiom for the
 * same admin surface.
 */
export function TeamsList({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [teams, setTeams] = useState<TeamListItem[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const result = await fetchJson<{ teams: TeamListItem[] }>("/api/v1/admin/teams");
    if (result.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    setTeams(result.data.teams ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  if (forbidden) return <AccessDeniedState moduleLabel="Agent Platform" />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Teams</h1>
        {canWrite && <Button onClick={() => router.push("/teams/new")}>+ New Team</Button>}
      </div>

      <p className="text-muted-foreground mb-4 text-sm">
        A team composes one cheap router-class supervisor with one or more scoped specialists. Delegation reuses the Tool
        Catalog, the permission rules and the Approval Queue — a Tier-3 action still stops for human approval at every
        delegation depth.
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

      {teams === null && !error ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" role="status" aria-label="Loading teams" />
          <Skeleton className="h-10 w-full" role="status" aria-label="Loading teams" />
        </div>
      ) : teams && teams.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground mb-4">No teams yet</p>
          {canWrite && <Button onClick={() => router.push("/teams/new")}>+ New Team</Button>}
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
            {teams?.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <NextLink href={`/teams/${t.id}`} className="text-primary font-medium underline-offset-4 hover:underline">
                    {t.name}
                  </NextLink>
                </TableCell>
                <TableCell>{t.status}</TableCell>
                <TableCell>{t.currentVersionId ? "Yes" : "No"}</TableCell>
                <TableCell>
                  <span className="block max-w-[360px] truncate" title={t.description ?? undefined}>
                    {t.description ?? "—"}
                  </span>
                </TableCell>
                <TableCell>{new Date(t.updatedAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
