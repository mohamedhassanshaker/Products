"use client";

import { useEffect, useState } from "react";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Switch } from "@nextbot/ui/components/ui/switch";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@nextbot/ui/components/ui/tooltip";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";

type Effect = "Allow" | "Deny" | "RequireApproval";
type Tier = "Tier1" | "Tier2" | "Tier3";

interface RuleRow {
  id: string;
  ordinal: number;
  effect: Effect;
  requiredTier: Tier | null;
  enabled: boolean;
}

const READONLY_TOOLTIP = "You have read-only access to this module";

/**
 * QA Final Review S2 — a minimal editor for a tool's own Tool-scoped permission
 * rules (the ordered list `PUT /api/v1/admin/tools/{id}/permissions` replaces
 * wholesale). Deliberately scoped to `scope: "Tool"` rules only — Connector/
 * BackendType-scope rules are the seeded defaults `ensureBackendTypeDefaultRule`
 * manages and aren't this screen's concern; an admin overriding a specific tool's
 * tier (e.g. forcing Tier-3 approval) is exactly BL-03's own worked example.
 */
export function ToolPermissionRules({ toolId, canMutate }: { toolId: string; canMutate: boolean }) {
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const result = await fetchJson<{ rules: RuleRow[] }>(`/api/v1/admin/tools/${toolId}/permissions`);
    if (result.kind === "ok") setRules(result.data.rules ?? []);
  }

  useEffect(() => {
    void load();
  }, [toolId]);

  function updateRule(index: number, patch: Partial<RuleRow>) {
    setRules((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[index] = { ...next[index]!, ...patch };
      return next;
    });
  }

  function addRule() {
    setRules((prev) => [
      ...(prev ?? []),
      { id: `new-${Date.now()}`, ordinal: (prev?.length ?? 0), effect: "RequireApproval", requiredTier: "Tier3", enabled: true },
    ]);
  }

  function removeRule(index: number) {
    setRules((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  async function save() {
    if (!rules) return;
    setSaving(true);
    try {
      const body = rules.map((r) => ({
        scope: "Tool" as const,
        toolId,
        ordinal: r.ordinal,
        conditions: {},
        effect: r.effect,
        requiredTier: r.effect === "RequireApproval" ? (r.requiredTier ?? "Tier3") : undefined,
        enabled: r.enabled,
      }));
      const res = await fetch(`/api/v1/admin/tools/${toolId}/permissions`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => null);
        toast.error(problem?.title ?? "Failed to save permission rules.");
        return;
      }
      toast.success("Permission rules saved.");
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (!rules) return <Skeleton className="h-8 w-32" role="status" aria-label="Loading permission rules" />;

  return (
    <div>
      <h1 className="mb-6 font-heading text-lg font-semibold">Tool Permission Rules</h1>
      <p className="mb-4 text-muted-foreground">
        Tool-scoped rules only — evaluated before this tool falls back to its connector/backend-type defaults (LLD §3.6).
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ordinal</TableHead>
            <TableHead>Effect</TableHead>
            <TableHead>Required tier</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((r, i) => (
            <TableRow key={r.id}>
              <TableCell>
                <Input
                  type="number"
                  className="w-[80px]"
                  min={0}
                  disabled={!canMutate}
                  value={r.ordinal}
                  onChange={(e) => updateRule(i, { ordinal: Number(e.target.value) })}
                  aria-label={`Ordinal for rule ${i + 1}`}
                />
              </TableCell>
              <TableCell>
                <Select
                  disabled={!canMutate}
                  value={r.effect}
                  onValueChange={(v) => updateRule(i, { effect: v as Effect })}
                >
                  <SelectTrigger className="w-[180px]" aria-label={`Effect for rule ${i + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Allow">Allow</SelectItem>
                    <SelectItem value="Deny">Deny</SelectItem>
                    <SelectItem value="RequireApproval">Require approval</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Select
                  disabled={!canMutate || r.effect !== "RequireApproval"}
                  value={r.requiredTier ?? "Tier1"}
                  onValueChange={(v) => updateRule(i, { requiredTier: v as Tier })}
                >
                  <SelectTrigger className="w-[140px]" aria-label={`Required tier for rule ${i + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Tier1">Tier 1</SelectItem>
                    <SelectItem value="Tier2">Tier 2</SelectItem>
                    <SelectItem value="Tier3">Tier 3</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span tabIndex={canMutate ? -1 : 0} className="inline-block">
                        <Switch
                          checked={r.enabled}
                          disabled={!canMutate}
                          aria-label={`Enable rule ${i + 1}`}
                          onCheckedChange={(checked) => updateRule(i, { enabled: checked })}
                        />
                      </span>
                    }
                  />
                  {!canMutate && <TooltipContent>{READONLY_TOOLTIP}</TooltipContent>}
                </Tooltip>
              </TableCell>
              <TableCell>
                <Button size="sm" variant="ghost" disabled={!canMutate} onClick={() => removeRule(i)}>
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" onClick={addRule} disabled={!canMutate}>
          Add rule
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <span tabIndex={canMutate ? -1 : 0} className="inline-block">
                <Button size="sm" onClick={() => void save()} disabled={saving || !canMutate}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </span>
            }
          />
          {!canMutate && <TooltipContent>{READONLY_TOOLTIP}</TooltipContent>}
        </Tooltip>
      </div>
    </div>
  );
}
