"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { AccessDeniedState, StatusBadge, type StatusTone } from "@nextbot/ui";
import { Button, buttonVariants } from "@nextbot/ui/components/ui/button";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Tooltip, TooltipTrigger, TooltipContent } from "@nextbot/ui/components/ui/tooltip";
import type { ConnectorStatusValue, PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "../../../src/lib/fetch-json";

interface ConnectorListItem {
  id: string;
  name: string;
  backendType: string;
  environment: string;
  status: ConnectorStatusValue;
}

const STATUS_TONE: Record<ConnectorStatusValue, StatusTone> = {
  Connected: "connected",
  Degraded: "degraded",
  Offline: "offline",
};

export function ConnectorsList({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const [connectors, setConnectors] = useState<ConnectorListItem[] | null>(null);
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // QA Defect U3: distinguishes "the API denied us" from "the list is genuinely
  // empty" — defense in depth alongside the page-level SSR guard (page.tsx), in
  // case a session's permissions change between the SSR check and this fetch.
  const [forbidden, setForbidden] = useState(false);

  // QA Defect U4: Read-only roles keep full visibility but every mutating control
  // (Add Connector, Discover Tools) is rendered disabled with an explanatory
  // tooltip, per `docs/design/UX_GUIDELINES.md` §2.3 — not simply removed, so the
  // user understands the capability exists but isn't theirs.
  const canWrite = permissionLevel === "Write";

  async function load() {
    const result = await fetchJson<{ connectors: ConnectorListItem[] }>("/api/v1/admin/connectors");
    if (result.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (result.kind === "ok") {
      setConnectors(result.data.connectors ?? []);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleDiscover(id: string) {
    setDiscovering(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/connectors/${id}/discover`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        // FR-MCP-02: show the verbatim transport error, not a generic message.
        setMessage(data.title ?? "Discovery failed.");
      } else if (data.toolsAdded === 0 && data.toolsUpdated === 0) {
        // QA Defect U12: "Discovered 0 new tool(s), updated 0." read like a bug
        // report, not a result — restate it as what actually happened plus guidance.
        setMessage("This MCP server reported no available tools. Check the server's tool configuration, or try again after it's ready.");
      } else {
        setMessage(`Discovered ${data.toolsAdded} new tool(s), updated ${data.toolsUpdated}.`);
      }
    } finally {
      setDiscovering(null);
    }
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Connectors" />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Connectors</h1>
        {canWrite ? (
          // Phase 3 (BL-34, LLD §14.3.1) — new enrolments go through the 9-step
          // wizard, not this screen's own (superseded) single-page form.
          <NextLink href="/mcp/servers/new" className={buttonVariants()}>
            Add Connector
          </NextLink>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <span tabIndex={0} className="inline-block">
                  <Button disabled aria-disabled="true">
                    Add Connector
                  </Button>
                </span>
              }
            />
            <TooltipContent>You have read-only access to this module</TooltipContent>
          </Tooltip>
        )}
      </div>
      {message && (
        <p className="mb-4" role="status">
          {message}
        </p>
      )}
      {!connectors ? (
        <Skeleton className="h-32 w-full" role="status" aria-label="Loading connectors" />
      ) : connectors.length === 0 ? (
        <p className="text-muted-foreground">No connectors yet — add one to get started.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Backend</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connectors.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <NextLink href={`/connectors/${c.id}`} className="text-primary underline-offset-4 hover:underline">
                    {c.name}
                  </NextLink>
                </TableCell>
                <TableCell>{c.backendType}</TableCell>
                <TableCell>{c.environment}</TableCell>
                <TableCell>
                  <StatusBadge tone={STATUS_TONE[c.status]} label={c.status} />
                </TableCell>
                <TableCell>
                  {canWrite ? (
                    <Button size="sm" disabled={discovering === c.id} onClick={() => handleDiscover(c.id)}>
                      {discovering === c.id ? "Discovering…" : "Discover Tools"}
                    </Button>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger
                        id={`discover-tooltip-trigger-${c.id}`}
                        render={
                          <span tabIndex={0} className="inline-block">
                            <Button size="sm" disabled aria-disabled="true">
                              Discover Tools
                            </Button>
                          </span>
                        }
                      />
                      <TooltipContent>You have read-only access to this module</TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
