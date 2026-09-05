"use client";

import { useEffect, useMemo, useState } from "react";
import NextLink from "next/link";
import { buttonVariants } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Switch } from "@nextbot/ui/components/ui/switch";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@nextbot/ui/components/ui/tooltip";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { AccessDeniedState } from "@nextbot/ui";
import { cn } from "@nextbot/ui/lib/utils";
import { fetchJson } from "../../../src/lib/fetch-json";

interface ToolListItem {
  id: string;
  name: string;
  displayName: string | null;
  connectorId: string;
  rwClass: "Read" | "Write";
  approvalTier: "Tier1" | "Tier2" | "Tier3";
  visibleToAgent: boolean;
  priorityWeight: number;
  status: "Active" | "Disabled" | "Error" | "Removed";
  lastCalledAt: string | null;
}

const READONLY_TOOLTIP = "You have read-only access to this module";
/** Base UI's `Select` (unlike the native `<select>` this replaces) can't represent
 * "no value selected" via an empty string the way Chakra's `placeholder` prop did —
 * an explicit sentinel value stands in for "All" and is filtered back out to `""`
 * before being applied. */
const ALL_VALUE = "__all__";

/**
 * Tool Catalog (BL-03 UI slice, `docs/design/UX_GUIDELINES.md` §4). The "—" vs "0%"
 * distinction (FR-MCP-03): `lastCalledAt === null` means "never observed" (renders
 * "—"), which is a materially different fact from "observed and its success rate is
 * genuinely 0%" — this dispatch doesn't yet compute a call-success rate (that's the
 * reporting rollup, BL-17), so every tool shows "—" today; the column exists so the
 * distinction is visible in the UI shape once that data lands.
 *
 * @param canMutate whether the caller's `agent_tool_config` permission is `Write` —
 *   computed server-side (`page.tsx`, QA Defect U3/U4) since the read (`tool_
 *   permissions`) and mutate (`agent_tool_config`) RBAC modules for this screen are
 *   genuinely distinct, so a viewer can legitimately have Read on one and None on
 *   the other.
 */
export function ToolCatalog({ canMutate }: { canMutate: boolean }) {
  const [tools, setTools] = useState<ToolListItem[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // QA Defect U11: basic filter bar (connector/type/tier/status), client-side over
  // the already-loaded catalog — genuinely absent before this fix, not a previously
  // disclosed simplification.
  const [connectorFilter, setConnectorFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [tierFilter, setTierFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  async function load() {
    const result = await fetchJson<{ tools: ToolListItem[] }>("/api/v1/admin/tools");
    if (result.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (result.kind === "ok") {
      setTools(result.data.tools ?? []);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function patchTool(id: string, patch: Record<string, unknown>) {
    if (!canMutate) return; // defense in depth — controls are already disabled
    await fetch(`/api/v1/admin/tools/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    await load();
  }

  const connectorOptions = useMemo(() => {
    if (!tools) return [];
    return Array.from(new Set(tools.map((t) => t.connectorId)));
  }, [tools]);

  const filteredTools = useMemo(() => {
    if (!tools) return null;
    return tools.filter(
      (t) =>
        (!connectorFilter || t.connectorId === connectorFilter) &&
        (!typeFilter || t.rwClass === typeFilter) &&
        (!tierFilter || t.approvalTier === tierFilter) &&
        (!statusFilter || t.status === statusFilter),
    );
  }, [tools, connectorFilter, typeFilter, tierFilter, statusFilter]);

  if (forbidden) return <AccessDeniedState moduleLabel="Tool Catalog" />;

  return (
    <div>
      <h1 className="mb-6 font-heading text-lg font-semibold">Tool Catalog</h1>
      {tools && tools.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-4">
          <div>
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="tool-catalog-filter-connector" className="text-xs">
                Connector
              </Label>
              <FieldHint
                id="tool-catalog-filter-connector-hint"
                content="Narrows the table below to tools discovered through a single connector — purely a client-side view filter, it doesn't change any tool's actual connector assignment."
              />
            </div>
            <Select value={connectorFilter || ALL_VALUE} onValueChange={(v) => v !== null && setConnectorFilter(v === ALL_VALUE ? "" : v)}>
              <SelectTrigger id="tool-catalog-filter-connector" className="w-[220px]" aria-label="Filter by connector">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All connectors</SelectItem>
                {connectorOptions.map((id) => (
                  <SelectItem key={id} value={id}>
                    Connector {id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="tool-catalog-filter-type" className="text-xs">
                Type
              </Label>
              <FieldHint
                id="tool-catalog-filter-type-hint"
                content="Narrows the table below to tools of one read/write class (`rwClass`) — this is the same distinction the approval-tier and permission-rule logic uses to decide whether a call needs escalation."
              />
            </div>
            <Select value={typeFilter || ALL_VALUE} onValueChange={(v) => v !== null && setTypeFilter(v === ALL_VALUE ? "" : v)}>
              <SelectTrigger id="tool-catalog-filter-type" className="w-[160px]" aria-label="Filter by type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All types</SelectItem>
                <SelectItem value="Read">Read</SelectItem>
                <SelectItem value="Write">Write</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="tool-catalog-filter-tier" className="text-xs">
                Tier
              </Label>
              <FieldHint
                id="tool-catalog-filter-tier-hint"
                content="Narrows the table below to tools currently defaulting to one approval tier — the actual tier a call is subject to can still be overridden per-tool on that tool's own Permissions screen."
              />
            </div>
            <Select value={tierFilter || ALL_VALUE} onValueChange={(v) => v !== null && setTierFilter(v === ALL_VALUE ? "" : v)}>
              <SelectTrigger id="tool-catalog-filter-tier" className="w-[160px]" aria-label="Filter by tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All tiers</SelectItem>
                <SelectItem value="Tier1">Tier 1</SelectItem>
                <SelectItem value="Tier2">Tier 2</SelectItem>
                <SelectItem value="Tier3">Tier 3</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="tool-catalog-filter-status" className="text-xs">
                Status
              </Label>
              <FieldHint
                id="tool-catalog-filter-status-hint"
                content="Narrows the table below to tools in one lifecycle status (e.g. Disabled/Error) — a tool's status reflects its connector's discovery/health state, it isn't set directly on this screen."
              />
            </div>
            <Select value={statusFilter || ALL_VALUE} onValueChange={(v) => v !== null && setStatusFilter(v === ALL_VALUE ? "" : v)}>
              <SelectTrigger id="tool-catalog-filter-status" className="w-[160px]" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All statuses</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Disabled">Disabled</SelectItem>
                <SelectItem value="Error">Error</SelectItem>
                <SelectItem value="Removed">Removed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      {!tools ? (
        <Skeleton className="h-8 w-32" role="status" aria-label="Loading tool catalog" />
      ) : tools.length === 0 ? (
        <p className="text-muted-foreground">No tools discovered yet — discover tools from a connector first.</p>
      ) : filteredTools && filteredTools.length === 0 ? (
        <p className="text-muted-foreground">No tools match the current filters.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Call rate</TableHead>
              <TableHead>Visible to agent</TableHead>
              <TableHead>Priority weight</TableHead>
              <TableHead>Permissions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTools!.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.displayName ?? t.name}</TableCell>
                <TableCell>{t.rwClass}</TableCell>
                <TableCell>{t.approvalTier}</TableCell>
                <TableCell>{t.status}</TableCell>
                <TableCell aria-label={t.lastCalledAt ? undefined : "no call data yet"}>{t.lastCalledAt ? "…" : "—"}</TableCell>
                <TableCell>
                  {/* QA Defect U4: Read-only callers see the same control, disabled
                      with an explanatory tooltip — not simply hidden (that's the
                      None-access case, U3). */}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span tabIndex={canMutate ? -1 : 0} className="inline-block">
                          <Switch
                            checked={t.visibleToAgent}
                            disabled={!canMutate}
                            aria-label={`Toggle visibility for ${t.displayName ?? t.name}`}
                            onCheckedChange={(checked) => patchTool(t.id, { visibleToAgent: checked })}
                          />
                        </span>
                      }
                    />
                    {!canMutate && <TooltipContent>{READONLY_TOOLTIP}</TooltipContent>}
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span tabIndex={canMutate ? -1 : 0} className="inline-block">
                          <Input
                            type="number"
                            className="w-[90px]"
                            min={1}
                            max={100}
                            disabled={!canMutate}
                            defaultValue={t.priorityWeight}
                            aria-label={`Priority weight for ${t.displayName ?? t.name}`}
                            onBlur={(e) => patchTool(t.id, { priorityWeight: Number(e.target.value) })}
                          />
                        </span>
                      }
                    />
                    {!canMutate && <TooltipContent>{READONLY_TOOLTIP}</TooltipContent>}
                  </Tooltip>
                </TableCell>
                <TableCell>
                  {/* QA Final Review S2: the previously-unreachable path to a
                      tool's own permission-rule matrix (view/set approval tier),
                      not gated behind hand-crafted API calls anymore. */}
                  <NextLink href={`/tools/${t.id}/permissions`} className={cn(buttonVariants({ size: "sm", variant: "link" }))}>
                    Edit permissions
                  </NextLink>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
