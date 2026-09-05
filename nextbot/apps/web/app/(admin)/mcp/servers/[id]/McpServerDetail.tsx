"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { AccessDeniedState, StatusBadge } from "@nextbot/ui";
import { Button } from "@nextbot/ui/components/ui/button";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nextbot/ui/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "../../../../../src/lib/fetch-json";

interface ManifestItem {
  id: string;
  kind: "Tool" | "Resource" | "Prompt";
  name: string;
  descriptionSource: string;
  ioClass: "Read" | "Write";
  approvalTier: "Tier1" | "Tier2" | "Tier3";
  enabled: boolean;
  capabilityGroupId: string | null;
  knowledgeIngestionCandidate: boolean;
}
interface Binding {
  id: string;
  environment: "Sandbox" | "Staging" | "Production";
  endpointUrl: string | null;
  reachability: "Unknown" | "Reachable" | "Unreachable";
  connectorId: string;
}
interface Version {
  id: string;
  version: number;
  status: "Draft" | "Approved" | "Superseded";
  manifestHash: string;
  itemCount: number;
  transport: string | null;
  authMethod: string | null;
  policyJson: unknown;
  createdAt: string;
}
interface ServerDetail {
  id: string;
  name: string;
  description: string | null;
  backendType: string | null;
  status: "Active" | "Suspended" | "Retired";
  criticality?: string;
  trustLevel?: string;
  currentVersionId: string | null;
  reachability: "Unknown" | "Reachable" | "Unreachable";
}

const REACHABILITY_TONE: Record<string, "connected" | "degraded" | "offline"> = {
  Reachable: "connected",
  Unknown: "degraded",
  Unreachable: "offline",
};

/** `/mcp/servers/{id}` — definition detail, tabbed per the Blueprint's §6.3 route
 * table (Manifest/Tools/Resources/Prompts/Policy/Environments/Versions/Health). */
export function McpServerDetail({ serverId, permissionLevel }: { serverId: string; permissionLevel: PermissionLevelValue }) {
  const [server, setServer] = useState<ServerDetail | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [manifestItems, setManifestItems] = useState<ManifestItem[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canWrite = permissionLevel === "Write";

  async function load() {
    const detail = await fetchJson<{ mcpServer: ServerDetail; bindings: Binding[]; manifestItems: ManifestItem[] }>(`/api/v1/admin/mcp/servers/${serverId}`);
    if (detail.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (detail.kind === "ok") {
      setServer(detail.data.mcpServer);
      setBindings(detail.data.bindings ?? []);
      setManifestItems(detail.data.manifestItems ?? []);
    }
    const versionsResult = await fetchJson<{ versions: Version[] }>(`/api/v1/admin/mcp/servers/${serverId}/versions`);
    if (versionsResult.kind === "ok") setVersions(versionsResult.data.versions ?? []);
  }

  useEffect(() => {
    void load();
  }, [serverId]);

  async function handleReconcile() {
    setReconciling(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/mcp/servers/${serverId}/reconcile`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.title ?? "Reconciliation failed.");
      } else if (data.outcome === "DriftDetected") {
        setMessage(`Drift detected — ${data.driftEventsInserted} change(s) pending review.`);
      } else {
        setMessage(`Reconciliation result: ${data.outcome}.`);
      }
      await load();
    } finally {
      setReconciling(false);
    }
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Connectors" />;
  if (!server) return <Skeleton className="h-32 w-full" role="status" aria-label="Loading MCP server" />;

  const currentVersion = versions.find((v) => v.id === server.currentVersionId);
  const tools = manifestItems.filter((i) => i.kind === "Tool");
  const resources = manifestItems.filter((i) => i.kind === "Resource");
  const prompts = manifestItems.filter((i) => i.kind === "Prompt");

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-lg font-semibold">{server.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="secondary">{server.backendType ?? "Unassigned backend"}</Badge>
            <Badge variant="secondary">{server.criticality ?? "Medium"}</Badge>
            <StatusBadge tone={REACHABILITY_TONE[server.reachability] ?? "degraded"} label={server.reachability} />
          </div>
        </div>
        <div className="flex gap-2">
          {canWrite && (
            <Button variant="secondary" disabled={reconciling} onClick={handleReconcile}>
              {reconciling ? "Reconciling…" : "Reconcile now"}
            </Button>
          )}
          <NextLink href={`/mcp/servers/${serverId}/drift`} className="inline-flex">
            <Button variant="outline">Review drift</Button>
          </NextLink>
        </div>
      </div>
      {message && <p className="mb-4" role="status">{message}</p>}

      <Tabs defaultValue="manifest">
        <TabsList>
          <TabsTrigger id="mcp-detail-tab-manifest" panelId="mcp-detail-panel-manifest" value="manifest">Manifest</TabsTrigger>
          <TabsTrigger id="mcp-detail-tab-tools" panelId="mcp-detail-panel-tools" value="tools">Tools</TabsTrigger>
          <TabsTrigger id="mcp-detail-tab-resources" panelId="mcp-detail-panel-resources" value="resources">Resources</TabsTrigger>
          <TabsTrigger id="mcp-detail-tab-prompts" panelId="mcp-detail-panel-prompts" value="prompts">Prompts</TabsTrigger>
          <TabsTrigger id="mcp-detail-tab-policy" panelId="mcp-detail-panel-policy" value="policy">Policy</TabsTrigger>
          <TabsTrigger id="mcp-detail-tab-environments" panelId="mcp-detail-panel-environments" value="environments">Environments</TabsTrigger>
          <TabsTrigger id="mcp-detail-tab-versions" panelId="mcp-detail-panel-versions" value="versions">Versions</TabsTrigger>
          <TabsTrigger id="mcp-detail-tab-health" panelId="mcp-detail-panel-health" value="health">Health</TabsTrigger>
        </TabsList>

        <TabsContent id="mcp-detail-panel-manifest" value="manifest">
          <p className="mb-2 text-sm text-muted-foreground">
            Pinned manifest hash: <code>{currentVersion?.manifestHash ?? "—"}</code> ({currentVersion?.itemCount ?? 0} items, v{currentVersion?.version ?? "—"})
          </p>
          <ManifestTable items={manifestItems} />
        </TabsContent>
        <TabsContent id="mcp-detail-panel-tools" value="tools"><ManifestTable items={tools} /></TabsContent>
        <TabsContent id="mcp-detail-panel-resources" value="resources"><ManifestTable items={resources} /></TabsContent>
        <TabsContent id="mcp-detail-panel-prompts" value="prompts"><ManifestTable items={prompts} /></TabsContent>

        <TabsContent id="mcp-detail-panel-policy" value="policy">
          {currentVersion?.policyJson ? (
            <pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(currentVersion.policyJson, null, 2)}</pre>
          ) : (
            <p className="text-muted-foreground">No runtime policy recorded for this version.</p>
          )}
        </TabsContent>

        <TabsContent id="mcp-detail-panel-environments" value="environments">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Environment</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Reachability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bindings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{b.environment}</TableCell>
                  <TableCell>{b.endpointUrl ?? "—"}</TableCell>
                  <TableCell><StatusBadge tone={REACHABILITY_TONE[b.reachability] ?? "degraded"} label={b.reachability} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent id="mcp-detail-panel-versions" value="versions">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Manifest hash</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>v{v.version}</TableCell>
                  <TableCell><Badge variant="secondary">{v.status}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{v.manifestHash.slice(0, 16)}…</TableCell>
                  <TableCell>{new Date(v.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent id="mcp-detail-panel-health" value="health">
          <p className="text-muted-foreground">
            Per-binding reachability is shown in the Environments tab above. Latency/error-rate history is tracked by the
            existing MCP Health screen against each binding&apos;s underlying connector.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ManifestTable({ items }: { items: ManifestItem[] }) {
  if (items.length === 0) return <p className="text-muted-foreground">No items.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Read/Write</TableHead>
          <TableHead>Approval tier</TableHead>
          <TableHead>Enabled</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>{item.name}</TableCell>
            <TableCell><Badge variant="secondary">{item.kind}</Badge></TableCell>
            <TableCell>{item.ioClass}</TableCell>
            <TableCell>{item.approvalTier}</TableCell>
            <TableCell>{item.enabled ? "Yes" : "No"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
