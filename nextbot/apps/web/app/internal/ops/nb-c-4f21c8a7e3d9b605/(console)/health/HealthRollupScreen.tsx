"use client";

import { useEffect, useMemo, useState } from "react";
import NextLink from "next/link";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { CONNECTED_BADGE_CLASS, DEGRADED_BADGE_CLASS } from "@nextbot/ui/lib/status-badge";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Checkbox } from "@nextbot/ui/components/ui/checkbox";
import { Label } from "@nextbot/ui/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { fetchJson } from "@/src/lib/fetch-json";

/** One connector rollup row, mirroring `ConnectorHealthRollupRow` from
 * `apps/web/app/api/internal/ops/health-rollup/route.ts` — metadata only, see that
 * file's doc comment for the NFR-11 accounting. */
interface ConnectorHealthRollupRow {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  connectorId: string;
  connectorName: string;
  status: "Connected" | "Degraded" | "Offline";
  lastCheckedAt: string | null;
  lastCheckOk: boolean | null;
  errorRatePct: number;
  recentErrorCount: number;
  callVolume: number;
}

/** Connector status → Badge treatment, same "solid, pre-verified pairing" convention
 * as `McpHealthDashboard.tsx`'s `CONNECTOR_STATUS_BADGE` and `TenantListScreen.tsx`'s
 * `STATUS_BADGE` — reusing the shared, contrast-verified constants both of those still
 * re-type as literals, so this screen has exactly one place defining the colors. */
const STATUS_BADGE: Record<
  ConnectorHealthRollupRow["status"],
  { variant?: "default" | "secondary" | "outline" | "destructive"; className?: string }
> = {
  Connected: { className: CONNECTED_BADGE_CLASS },
  Degraded: { className: DEGRADED_BADGE_CLASS },
  Offline: { variant: "destructive" },
};

/** Rank used to sort "needs attention" rows to the top: worst status first. */
const STATUS_RANK: Record<ConnectorHealthRollupRow["status"], number> = { Offline: 0, Degraded: 1, Connected: 2 };

/**
 * Platform Manager console Health screen (Phase 3, NFR-11) — a cross-tenant rollup
 * of every connector's computed health status, so an operator can answer "which
 * tenants need attention right now" in one screen rather than opening each tenant's
 * own admin console's MCP Health dashboard individually. Read-only, incident-response
 * oriented: no connector management actions live here (those already exist per-tenant
 * at `/(admin)/mcp-health`).
 *
 * Modeled on `TenantListScreen.tsx`'s data-fetch/sort/filter pattern and
 * `McpHealthDashboard.tsx`'s connector-status Badge convention.
 */
export function HealthRollupScreen() {
  const [rows, setRows] = useState<ConnectorHealthRollupRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(true);

  async function reload() {
    setError(null);
    const result = await fetchJson<{ connectors: ConnectorHealthRollupRow[] }>("/api/internal/ops/health-rollup");
    if (result.kind === "forbidden" || result.kind === "error") {
      setError(result.message);
      return;
    }
    setRows(result.data.connectors);
  }

  useEffect(() => {
    void reload();
  }, []);

  const visibleRows = useMemo(() => {
    if (!rows) return null;
    const filtered = attentionOnly ? rows.filter((r) => r.status !== "Connected") : rows;
    return [...filtered].sort((a, b) => {
      const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (rankDiff !== 0) return rankDiff;
      return a.tenantName.localeCompare(b.tenantName) || a.connectorName.localeCompare(b.connectorName);
    });
  }, [rows, attentionOnly]);

  const degradedOrWorseCount = useMemo(() => rows?.filter((r) => r.status !== "Connected").length ?? 0, [rows]);
  const tenantsNeedingAttention = useMemo(() => {
    if (!rows) return 0;
    return new Set(rows.filter((r) => r.status !== "Connected").map((r) => r.tenantId)).size;
  }, [rows]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Health</h1>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!error && rows && (
        <p className="mb-4 text-sm text-muted-foreground">
          {degradedOrWorseCount === 0
            ? "No degraded or offline connectors across any tenant."
            : `${degradedOrWorseCount} connector${degradedOrWorseCount === 1 ? "" : "s"} across ${tenantsNeedingAttention} tenant${
                tenantsNeedingAttention === 1 ? "" : "s"
              } need attention.`}
        </p>
      )}

      <div className="mb-4 flex items-center gap-2">
        <Checkbox id="attention-only" checked={attentionOnly} onCheckedChange={(checked) => setAttentionOnly(checked === true)} />
        <Label htmlFor="attention-only">Show only degraded/offline connectors</Label>
      </div>

      {visibleRows === null ? (
        <Skeleton className="h-8 w-64" role="status" aria-label="Loading health rollup" />
      ) : visibleRows.length === 0 ? (
        <p className="text-muted-foreground">
          {attentionOnly ? "No connectors currently need attention." : "No connectors found across any tenant."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Connector</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last checked</TableHead>
              <TableHead>Error rate</TableHead>
              <TableHead>Recent errors</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => {
              const statusBadge = STATUS_BADGE[row.status];
              return (
                <TableRow key={`${row.tenantId}:${row.connectorId}`}>
                  <TableCell>
                    <NextLink
                      href={`/internal/ops/tenants/${row.tenantId}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {row.tenantName}
                    </NextLink>
                  </TableCell>
                  <TableCell>{row.connectorName}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadge.variant} className={statusBadge.className}>
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.lastCheckedAt ? new Date(row.lastCheckedAt).toLocaleString() : "Never checked"}</TableCell>
                  <TableCell>{row.errorRatePct}%</TableCell>
                  <TableCell>
                    {row.recentErrorCount} / {row.callVolume}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
