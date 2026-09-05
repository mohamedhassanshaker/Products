"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Label } from "@nextbot/ui/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { fetchJson } from "@/src/lib/fetch-json";

type GroupBy = "provider" | "model" | "route" | "agentVersion" | "channel";

interface UsageRow {
  groupKey: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  callCount: number;
  cacheHitCount: number;
  errorCount: number;
}

interface CostPerConversation {
  totalCostUsd: number;
  conversationCount: number;
  costPerConversation: number | null;
}

/** Target Architecture Blueprint Phase 2 (BL-33, FR-AGT-24) — the tenant-facing
 * usage/cost view: spend/volume by provider/model/route/agent-version/channel, plus
 * a cost-per-resolved-conversation figure. Reads a fixed trailing-30-day window
 * (matching this console's other reporting screens' default) grouped by the
 * selected dimension. */
export function UsageTab() {
  const [groupBy, setGroupBy] = useState<GroupBy>("provider");
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [costPerConversation, setCostPerConversation] = useState<CostPerConversation | null>(null);

  async function load(nextGroupBy: GroupBy) {
    setRows(null);
    const [usageResult, costResult] = await Promise.all([
      fetchJson<{ rows: UsageRow[] }>(`/api/v1/admin/model-gateway/usage?groupBy=${nextGroupBy}`),
      fetchJson<CostPerConversation>("/api/v1/admin/model-gateway/usage/cost-per-resolved-conversation"),
    ]);
    if (usageResult.kind === "ok") setRows(usageResult.data.rows);
    if (costResult.kind === "ok") setCostPerConversation(costResult.data);
  }

  useEffect(() => {
    void load(groupBy);
  }, [groupBy]);

  return (
    <div>
      <h2 className="mb-2 font-heading text-base font-semibold">Usage &amp; Cost</h2>
      <p className="mb-4 text-sm text-muted-foreground">Spend and volume over the last 30 days (FR-AGT-24).</p>

      <div className="mb-4 flex items-center gap-4">
        <div className="rounded-none border p-3">
          <p className="text-xs text-muted-foreground">Total spend</p>
          <p className="font-heading text-lg font-semibold">${(costPerConversation?.totalCostUsd ?? 0).toFixed(2)}</p>
        </div>
        <div className="rounded-none border p-3">
          <p className="text-xs text-muted-foreground">Resolved conversations</p>
          <p className="font-heading text-lg font-semibold">{costPerConversation?.conversationCount ?? 0}</p>
        </div>
        <div className="rounded-none border p-3">
          <p className="text-xs text-muted-foreground">Cost per resolved conversation</p>
          <p className="font-heading text-lg font-semibold">
            {costPerConversation?.costPerConversation != null ? `$${costPerConversation.costPerConversation.toFixed(4)}` : "—"}
          </p>
        </div>
      </div>

      <div className="mb-4 max-w-[220px]">
        <Label htmlFor="usage-group-by" className="mb-1 text-sm">
          Group by
        </Label>
        <Select value={groupBy} onValueChange={(v) => v !== null && setGroupBy(v as GroupBy)}>
          <SelectTrigger id="usage-group-by" aria-label="Group by" className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="provider">Provider</SelectItem>
            <SelectItem value="model">Model</SelectItem>
            <SelectItem value="route">Route</SelectItem>
            <SelectItem value="agentVersion">Agent version</SelectItem>
            <SelectItem value="channel">Channel</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {rows === null ? (
        <Skeleton className="h-20 w-full" role="status" aria-label="Loading usage data" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No usage recorded in this window yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{groupBy}</TableHead>
              <TableHead>Calls</TableHead>
              <TableHead>Cache hits</TableHead>
              <TableHead>Errors</TableHead>
              <TableHead>Tokens in</TableHead>
              <TableHead>Tokens out</TableHead>
              <TableHead>Cost (USD)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.groupKey}>
                <TableCell>{r.groupKey}</TableCell>
                <TableCell>{r.callCount}</TableCell>
                <TableCell>{r.cacheHitCount}</TableCell>
                <TableCell>{r.errorCount}</TableCell>
                <TableCell>{r.tokensIn}</TableCell>
                <TableCell>{r.tokensOut}</TableCell>
                <TableCell>${r.costUsd.toFixed(4)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
