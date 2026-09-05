"use client";

import { useEffect, useMemo, useState } from "react";
import NextLink from "next/link";
import { Button } from "@nextbot/ui/components/ui/button";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { WARNING_BADGE_CLASS } from "@nextbot/ui/lib/status-badge";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { AccessDeniedState } from "@nextbot/ui";
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface ConnectorHealthRow {
  connector: { id: string; name: string; status: string; environment: string };
  health: {
    callVolume: number;
    errorRatePct: number;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    p99LatencyMs: number | null;
  };
  /** QA fix (UI-D4) — 30-day uptime % for the server status grid. */
  uptime30dPct: number;
}
interface BreakerStatus {
  state: "Closed" | "Open" | "HalfOpen";
  consecutiveFailures: number;
  openedAt: string | null;
}

/** QA fix (UI-D4) — B.3A.4's tool-level health table row shape
 * (`@nextbot/approvals`'s `ToolHealthSummary`). */
interface ToolHealthRow {
  toolId: string;
  toolName: string;
  connectorId: string | null;
  callVolume: number;
  errorRatePct: number;
  lastErrorMessage: string | null;
  sparkline: Array<{ hour: string; calls: number; failures: number }>;
  uptime30dPct: number;
}

/** Connector-status → Badge treatment (same "solid, pre-verified pairing beyond the
 * four built-in variants" convention as `DefinitionDetail.tsx`'s `STATUS_BADGE`). */
const CONNECTOR_STATUS_BADGE: Record<string, { variant?: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  Connected: { className: "bg-emerald-700 text-white" },
  // QA fix (Batch D retry 1): amber-600/white failed WCAG AA (~3.19:1) — see
  // `WARNING_BADGE_CLASS`'s doc comment for the verified replacement/rationale.
  Degraded: { className: WARNING_BADGE_CLASS },
};

const BREAKER_STATE_BADGE: Record<BreakerStatus["state"], { variant?: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  Closed: { className: "bg-emerald-700 text-white" },
  HalfOpen: { className: WARNING_BADGE_CLASS },
  Open: { variant: "destructive" },
};

/** Tiny inline call-volume sparkline — no charting library dependency needed for
 * a handful of bars; renders relative bar heights from the hourly bucket counts. */
function Sparkline({ buckets }: { buckets: ToolHealthRow["sparkline"] }) {
  const max = Math.max(1, ...buckets.map((b) => b.calls));
  return (
    <div
      className="flex h-6 items-end gap-px"
      title={`${buckets.reduce((s, b) => s + b.calls, 0)} calls in 24h`}
    >
      {buckets.map((b) => (
        <div
          key={b.hour}
          className={b.failures > 0 ? "w-[3px] bg-red-400" : "w-[3px] bg-blue-300"}
          style={{ height: `${Math.max(2, Math.round((b.calls / max) * 24))}px` }}
        />
      ))}
      {buckets.length === 0 && <span className="text-xs text-muted-foreground">No calls</span>}
    </div>
  );
}

/**
 * B.3A.4 MCP Server Health & Monitoring — server status grid (with a 30d uptime
 * column and click-through to the connector detail page), the tool-level health
 * table (QA fix UI-D4: per-tool call volume, error rate, last error message,
 * call-volume sparkline, 30d uptime, sortable by error rate), and the
 * circuit-breaker status display wired to the real, Redis-backed, cross-process
 * breaker (`@nextbot/mcp-client`) with a genuine "Reset" action. Alert
 * configuration (thresholds/destinations) lives in this same page's
 * "Alert Configuration" tab (Plan Phase 3, client-feedback-batch item 11 —
 * relocated from a standalone `/settings/connector-alerts` screen, QA fix
 * UI-D5's original home, per B.3A.4's actual grouping).
 */
export function McpHealthDashboard({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const canEdit = permissionLevel === "Write";
  const [rows, setRows] = useState<ConnectorHealthRow[] | null>(null);
  const [breakers, setBreakers] = useState<Record<string, BreakerStatus> | null>(null);
  const [toolHealth, setToolHealth] = useState<ToolHealthRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortByErrorRate, setSortByErrorRate] = useState(true);

  async function reload() {
    setError(null);
    const result = await fetchJson<{
      connectors: ConnectorHealthRow[];
      breakerStatuses: Record<string, BreakerStatus>;
      toolHealth: ToolHealthRow[];
    }>("/api/v1/admin/mcp-health");
    if (result.kind === "forbidden") return setForbidden(true);
    if (result.kind === "error") return setError(result.message);
    setRows(result.data.connectors);
    setBreakers(result.data.breakerStatuses);
    setToolHealth(result.data.toolHealth);
  }

  const sortedToolHealth = useMemo(() => {
    if (!toolHealth) return null;
    const copy = [...toolHealth];
    return sortByErrorRate ? copy.sort((a, b) => b.errorRatePct - a.errorRatePct) : copy;
  }, [toolHealth, sortByErrorRate]);

  // QA Final Review minor item: the tool-level health table showed the raw
  // connector UUID instead of its name — this lookup (built from the server
  // status grid's own `rows`, already fetched) resolves it for display.
  const connectorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const { connector } of rows ?? []) map.set(connector.id, connector.name);
    return map;
  }, [rows]);

  useEffect(() => {
    void reload();
  }, []);

  async function reset(toolId: string) {
    const r = await fetchJson("/api/v1/admin/mcp-health/reset-breaker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolId }),
    });
    if (r.kind === "error") return setError(r.message);
    await reload();
  }

  if (forbidden) return <AccessDeniedState moduleLabel="MCP Health" />;

  return (
    <div className="p-6">
      <h1 className="mb-4 font-heading text-lg font-semibold">MCP Server Health</h1>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <h2 className="mb-2 font-heading text-base font-semibold">Server status grid</h2>
      {rows === null ? (
        <Skeleton className="mb-6 h-8 w-32" role="status" aria-label="Loading server status grid" />
      ) : (
        <Table className="mb-6">
          <TableHeader>
            <TableRow>
              <TableHead>Connector</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Env</TableHead>
              <TableHead>Calls (24h)</TableHead>
              <TableHead>Error %</TableHead>
              <TableHead>p50</TableHead>
              <TableHead>p95</TableHead>
              <TableHead>p99</TableHead>
              <TableHead>30d uptime</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ connector, health, uptime30dPct }) => {
              const statusBadge = CONNECTOR_STATUS_BADGE[connector.status] ?? { variant: "destructive" as const };
              return (
                <TableRow key={connector.id}>
                  <TableCell>
                    {/* QA fix (UI-D4): click-through to the connector detail page. */}
                    <NextLink href={`/connectors/${connector.id}`} className="text-primary underline-offset-4 hover:underline">
                      {connector.name}
                    </NextLink>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadge.variant} className={statusBadge.className}>
                      {connector.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{connector.environment}</TableCell>
                  <TableCell>{health.callVolume}</TableCell>
                  <TableCell>{health.errorRatePct}%</TableCell>
                  <TableCell>{health.p50LatencyMs ?? "—"}ms</TableCell>
                  <TableCell>{health.p95LatencyMs ?? "—"}ms</TableCell>
                  <TableCell>{health.p99LatencyMs ?? "—"}ms</TableCell>
                  <TableCell>{uptime30dPct}%</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-heading text-base font-semibold">Tool-level health (24h)</h2>
        <Button size="xs" onClick={() => setSortByErrorRate((v) => !v)}>
          {sortByErrorRate ? "Sorted by error rate ▾" : "Sort by error rate"}
        </Button>
      </div>

      {sortedToolHealth === null ? (
        <Skeleton className="mb-6 h-8 w-32" role="status" aria-label="Loading tool-level health" />
      ) : sortedToolHealth.length === 0 ? (
        <p className="mb-6 text-muted-foreground">No tool calls recorded in the last 24h.</p>
      ) : (
        <Table className="mb-6">
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Connector</TableHead>
              <TableHead>Calls (24h)</TableHead>
              <TableHead>Error %</TableHead>
              <TableHead>Last error</TableHead>
              <TableHead>Call volume (24h)</TableHead>
              <TableHead>30d uptime</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedToolHealth.map((t) => (
              <TableRow key={t.toolId}>
                <TableCell>{t.toolName}</TableCell>
                <TableCell>
                  {t.connectorId ? (
                    <NextLink href={`/connectors/${t.connectorId}`} className="text-primary underline-offset-4 hover:underline">
                      {connectorNameById.get(t.connectorId) ?? t.connectorId}
                    </NextLink>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>{t.callVolume}</TableCell>
                <TableCell>{t.errorRatePct}%</TableCell>
                <TableCell className="max-w-[240px] whitespace-normal">{t.lastErrorMessage ?? "—"}</TableCell>
                <TableCell>
                  <Sparkline buckets={t.sparkline} />
                </TableCell>
                <TableCell>{t.uptime30dPct}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <h2 className="mb-2 font-heading text-base font-semibold">Circuit breaker status (real, cross-process)</h2>
      {breakers === null ? (
        <Skeleton className="h-8 w-32" role="status" aria-label="Loading circuit breaker status" />
      ) : Object.keys(breakers).length === 0 ? (
        <p className="text-muted-foreground">No tool has recorded a breaker event yet — every tool is implicitly Closed.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool ID</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Consecutive failures</TableHead>
              <TableHead>Opened at</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(breakers).map(([toolId, status]) => {
              const stateBadge = BREAKER_STATE_BADGE[status.state];
              return (
                <TableRow key={toolId}>
                  <TableCell>{toolId}</TableCell>
                  <TableCell>
                    <Badge variant={stateBadge.variant} className={stateBadge.className}>
                      {status.state}
                    </Badge>
                  </TableCell>
                  <TableCell>{status.consecutiveFailures}</TableCell>
                  <TableCell>{status.openedAt ? new Date(status.openedAt).toLocaleString() : "—"}</TableCell>
                  <TableCell>
                    {canEdit && status.state !== "Closed" && (
                      <Button size="xs" onClick={() => void reset(toolId)}>
                        Reset
                      </Button>
                    )}
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
