"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { AccessDeniedState, StatusBadge } from "@nextbot/ui";
import { Button, buttonVariants } from "@nextbot/ui/components/ui/button";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "../../../../src/lib/fetch-json";

interface McpServerListItem {
  id: string;
  name: string;
  backendType: string | null;
  status: "Active" | "Suspended" | "Retired";
  criticality?: "Low" | "Medium" | "High" | "BusinessCritical";
  reachability: "Unknown" | "Reachable" | "Unreachable";
}

const REACHABILITY_TONE: Record<string, "connected" | "degraded" | "offline"> = {
  Reachable: "connected",
  Unknown: "degraded",
  Unreachable: "offline",
};

/** `/mcp/servers` — the registry list (Blueprint §6.3). Existing-connector rows are
 * not shown here directly (they still live at `/connectors`) until migrated via
 * "Migrate existing connectors", which wraps them in a real `mcp_server` row without
 * touching the underlying `connector` rows themselves (LLD §14.3.1). */
export function McpServersList({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const [servers, setServers] = useState<McpServerListItem[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canWrite = permissionLevel === "Write";

  async function load() {
    const result = await fetchJson<{ mcpServers: McpServerListItem[] }>("/api/v1/admin/mcp/servers");
    if (result.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (result.kind === "ok") setServers(result.data.mcpServers ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleMigrate() {
    setMigrating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/admin/mcp/servers/migrate-connectors", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.title ?? "Migration failed.");
      } else {
        setMessage(`Migrated ${data.serversCreated} server(s), ${data.bindingsCreated} binding(s). ${data.connectorsSkippedAlreadyBound} connector(s) already migrated.`);
        await load();
      }
    } finally {
      setMigrating(false);
    }
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Connectors" />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">MCP Servers</h1>
        <div className="flex gap-2">
          {canWrite && (
            <Button variant="secondary" disabled={migrating} onClick={handleMigrate}>
              {migrating ? "Migrating…" : "Migrate existing connectors"}
            </Button>
          )}
          {canWrite && (
            <NextLink href="/mcp/servers/new" className={buttonVariants()}>
              Enrol server
            </NextLink>
          )}
        </div>
      </div>
      {message && <p className="mb-4" role="status">{message}</p>}
      {!servers ? (
        <Skeleton className="h-32 w-full" role="status" aria-label="Loading MCP servers" />
      ) : servers.length === 0 ? (
        <p className="text-muted-foreground">No MCP servers enrolled yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Backend</TableHead>
              <TableHead>Criticality</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reachability</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {servers.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <NextLink href={`/mcp/servers/${s.id}`} className="text-primary underline-offset-4 hover:underline">
                    {s.name}
                  </NextLink>
                </TableCell>
                <TableCell>{s.backendType ?? "—"}</TableCell>
                <TableCell><Badge variant="secondary">{s.criticality ?? "Medium"}</Badge></TableCell>
                <TableCell>{s.status}</TableCell>
                <TableCell><StatusBadge tone={REACHABILITY_TONE[s.reachability] ?? "degraded"} label={s.reachability} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
