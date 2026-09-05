"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";

interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  status: "Active" | "Archived";
  currentVersionId: string | null;
}

interface SkillVersionRow {
  id: string;
  version: number;
  status: "Draft" | "Published" | "Deprecated";
  trigger: string;
  createdAt: string;
}

interface WhereUsedConsumer {
  consumerKind: "AgentVersion" | "WorkflowVersion";
  consumerId: string;
  consumerLabel: string;
  consumerStatus: string;
  pinnedSkillVersion: number;
  behindBy: number;
  pendingUpgradeDraftId: string | null;
}

interface WhereUsedResponse {
  consumers: WhereUsedConsumer[];
  currentPublishedVersion: number | null;
}

/**
 * Skill Detail (Target Architecture Blueprint Phase 5, BL-35, ADR-0015 §2.3/§2.4).
 * Renders the version list (publish/deprecate actions — a skill version is never
 * *deployed*, so there is no promotion gate here) and the where-used panel with the
 * "Upgrade consumers" action.
 */
export function SkillDetail({ skillId, canWrite }: { skillId: string; canWrite: boolean }) {
  const router = useRouter();
  const [skill, setSkill] = useState<SkillRow | null>(null);
  const [versions, setVersions] = useState<SkillVersionRow[] | null>(null);
  const [whereUsed, setWhereUsed] = useState<WhereUsedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  async function load() {
    const [skillResult, versionsResult, whereUsedResult] = await Promise.all([
      fetchJson<{ skill: SkillRow }>(`/api/v1/admin/skills/${skillId}`),
      fetchJson<{ versions: SkillVersionRow[] }>(`/api/v1/admin/skills/${skillId}/versions`),
      fetchJson<WhereUsedResponse>(`/api/v1/admin/skills/${skillId}/where-used`),
    ]);
    if (skillResult.kind === "ok") setSkill(skillResult.data.skill);
    else if (skillResult.kind === "error") setError(skillResult.message);
    if (versionsResult.kind === "ok") setVersions(versionsResult.data.versions);
    if (whereUsedResult.kind === "ok") setWhereUsed(whereUsedResult.data);
  }

  useEffect(() => {
    void load();
  }, [skillId]);

  async function handlePublish(versionId: string) {
    const result = await fetchJson(`/api/v1/admin/skills/${skillId}/versions/${versionId}/publish`, { method: "POST" });
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Version published.");
    void load();
  }

  async function handleDeprecate(versionId: string) {
    const result = await fetchJson(`/api/v1/admin/skills/${skillId}/versions/${versionId}/deprecate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Version deprecated.");
    void load();
  }

  async function handleUpgradeConsumers() {
    if (!skill?.currentVersionId) return;
    setUpgrading(true);
    const result = await fetchJson<{ created: unknown[]; skipped: Array<{ reason: string }> }>(`/api/v1/admin/skills/${skillId}/upgrade-consumers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toSkillVersionId: skill.currentVersionId }),
    });
    setUpgrading(false);
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success(`${result.data.created.length} new draft(s) generated, ${result.data.skipped.length} skipped. Every draft still needs to pass the normal promotion gate.`);
    void load();
  }

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

  if (!skill || !versions) {
    return <Skeleton className="h-[400px] w-full" role="status" aria-label="Loading skill" />;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-lg font-semibold">{skill.name}</h1>
          {skill.description && <p className="text-sm text-muted-foreground">{skill.description}</p>}
        </div>
        {canWrite && <Button onClick={() => router.push(`/skills/${skillId}/versions/new`)}>+ New Version</Button>}
      </div>

      <section>
        <h2 className="mb-2 font-heading text-base font-semibold">Versions</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Created</TableHead>
              {canWrite && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions
              .sort((a, b) => b.version - a.version)
              .map((v) => (
                <TableRow key={v.id}>
                  <TableCell>v{v.version}</TableCell>
                  <TableCell>
                    <Badge variant={v.status === "Draft" ? "secondary" : v.status === "Deprecated" ? "destructive" : "default"}>{v.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-[360px] truncate" title={v.trigger}>
                      {v.trigger}
                    </span>
                  </TableCell>
                  <TableCell>{new Date(v.createdAt).toLocaleString()}</TableCell>
                  {canWrite && (
                    <TableCell>
                      {v.status === "Draft" && (
                        <Button size="sm" onClick={() => void handlePublish(v.id)}>
                          Publish
                        </Button>
                      )}
                      {v.status === "Published" && (
                        <Button size="sm" variant="ghost" onClick={() => void handleDeprecate(v.id)}>
                          Deprecate
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold">Where used</h2>
          {canWrite && skill.currentVersionId && whereUsed && whereUsed.consumers.some((c) => c.behindBy > 0 && !c.pendingUpgradeDraftId) && (
            <Button size="sm" onClick={() => void handleUpgradeConsumers()} disabled={upgrading}>
              {upgrading ? "Upgrading…" : "Upgrade consumers"}
            </Button>
          )}
        </div>
        {!whereUsed || whereUsed.consumers.length === 0 ? (
          <p className="text-muted-foreground">No agent versions currently compose this skill.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Consumer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pinned version</TableHead>
                <TableHead>Behind by</TableHead>
                <TableHead>Pending upgrade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {whereUsed.consumers.map((c) => (
                <TableRow key={c.consumerId}>
                  <TableCell>{c.consumerLabel}</TableCell>
                  <TableCell>{c.consumerStatus}</TableCell>
                  <TableCell>v{c.pinnedSkillVersion}</TableCell>
                  <TableCell>{c.behindBy}</TableCell>
                  <TableCell>{c.pendingUpgradeDraftId ? "Pending (Draft, awaiting the normal promotion gate)" : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
