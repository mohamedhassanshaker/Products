"use client";

import { useEffect, useState } from "react";
import { Card } from "@nextbot/ui/components/ui/card";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@nextbot/ui/components/ui/alert-dialog";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";

type TenantPlanTier = "Starter" | "Growth" | "Enterprise";

interface PlanTierDefinitionDto {
  tier: TenantPlanTier;
  maxToolCallsPerSecond: number | null;
  maxConcurrentConversations: number | null;
  maxMcpConnectors: number | null;
  isDedicatedDatabase: boolean;
  features: string[];
  updatedAt: string;
}

/** Draft form state for one tier's edit fields — capped values are edited as text
 * so an empty field can mean "no cap" (`null`) distinctly from `0`. */
interface TierDraft {
  maxToolCallsPerSecond: string;
  maxConcurrentConversations: string;
  maxMcpConnectors: string;
  features: string;
}

function toDraft(def: PlanTierDefinitionDto): TierDraft {
  return {
    maxToolCallsPerSecond: def.maxToolCallsPerSecond === null ? "" : String(def.maxToolCallsPerSecond),
    maxConcurrentConversations: def.maxConcurrentConversations === null ? "" : String(def.maxConcurrentConversations),
    maxMcpConnectors: def.maxMcpConnectors === null ? "" : String(def.maxMcpConnectors),
    features: def.features.join("\n"),
  };
}

/** Parses a draft's text field back into `number | null` — blank means "no cap". */
function parseCap(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed);
}

/**
 * Platform Manager console Plan Tiers screen (Phase 2, NFR-11) — lists the three
 * fixed plan tiers (Starter/Growth/Enterprise, the existing `plan_tier` enum; not
 * arbitrary new tiers) and lets an operator edit each tier's quota-template fields
 * plus the descriptive `features` field.
 *
 * `features` is explicitly descriptive/forward-looking only — the copy below says
 * so directly, since no feature-gating mechanism anywhere else in the codebase
 * reads this field. Saving a tier's edits is gated behind a confirm dialog, same
 * "consequential mutation" treatment as the Tenant Detail screen's actions,
 * because a tier-definition edit changes what *future* provisioning/re-seeding
 * calls apply.
 */
export function PlanTiersScreen() {
  const [tiers, setTiers] = useState<PlanTierDefinitionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TierDraft>>({});
  const [confirmTier, setConfirmTier] = useState<TenantPlanTier | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const result = await fetchJson<{ tiers: PlanTierDefinitionDto[] }>("/api/internal/ops/plan-tiers");
    if (result.kind === "forbidden" || result.kind === "error") {
      setError(result.message);
      return;
    }
    setTiers(result.data.tiers);
    setDrafts(Object.fromEntries(result.data.tiers.map((t) => [t.tier, toDraft(t)])));
  }

  useEffect(() => {
    void load();
  }, []);

  function updateDraft(tier: string, patch: Partial<TierDraft>) {
    setDrafts((prev) => {
      const existing = prev[tier];
      if (!existing) return prev;
      return { ...prev, [tier]: { ...existing, ...patch } };
    });
  }

  async function confirmSave(tier: TenantPlanTier) {
    const draft = drafts[tier];
    if (!draft) return;
    setSubmitting(true);
    const result = await fetchJson(`/api/internal/ops/plan-tiers/${tier}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        maxToolCallsPerSecond: parseCap(draft.maxToolCallsPerSecond),
        maxConcurrentConversations: parseCap(draft.maxConcurrentConversations),
        maxMcpConnectors: parseCap(draft.maxMcpConnectors),
        features: draft.features
          .split("\n")
          .map((f) => f.trim())
          .filter((f) => f.length > 0),
      }),
    });
    setSubmitting(false);
    setConfirmTier(null);
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success(`${tier} tier definition saved.`);
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-lg font-semibold">Plan Tiers</h1>
      <p className="text-sm text-muted-foreground">
        These quota fields become the defaults new tenants are provisioned with, and what &quot;Re-seed quota from tier
        defaults&quot; applies on the Tenant Detail screen. The <strong>Features</strong> field is descriptive/forward-looking
        only — it is not enforced anywhere; no tenant is gated by it.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!error && !tiers && <Skeleton className="h-8 w-64" role="status" aria-label="Loading plan tiers" />}

      {!error &&
        tiers?.map((tier) => {
        const draft = drafts[tier.tier];
        if (!draft) return null;
        return (
          <Card key={tier.tier} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-base font-semibold">{tier.tier}</h2>
              {tier.isDedicatedDatabase && <span className="text-xs text-muted-foreground">Dedicated database</span>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor={`${tier.tier}-tool-calls`}>Max tool calls/sec (blank = no cap)</Label>
                <Input
                  id={`${tier.tier}-tool-calls`}
                  type="number"
                  min={0}
                  className="mt-1"
                  value={draft.maxToolCallsPerSecond}
                  onChange={(e) => updateDraft(tier.tier, { maxToolCallsPerSecond: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`${tier.tier}-conversations`}>Max concurrent conversations (blank = no cap)</Label>
                <Input
                  id={`${tier.tier}-conversations`}
                  type="number"
                  min={0}
                  className="mt-1"
                  value={draft.maxConcurrentConversations}
                  onChange={(e) => updateDraft(tier.tier, { maxConcurrentConversations: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`${tier.tier}-mcp-connectors`}>Max MCP connectors (blank = no cap)</Label>
                <Input
                  id={`${tier.tier}-mcp-connectors`}
                  type="number"
                  min={0}
                  className="mt-1"
                  value={draft.maxMcpConnectors}
                  onChange={(e) => updateDraft(tier.tier, { maxMcpConnectors: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-3">
              <Label htmlFor={`${tier.tier}-features`}>Features (descriptive/forward-looking only, one per line)</Label>
              <Textarea
                id={`${tier.tier}-features`}
                className="mt-1"
                value={draft.features}
                onChange={(e) => updateDraft(tier.tier, { features: e.target.value })}
              />
            </div>
            <Button className="mt-3" disabled={submitting} onClick={() => setConfirmTier(tier.tier)}>
              Save {tier.tier} tier
            </Button>
          </Card>
        );
      })}

      <AlertDialog open={confirmTier !== null} onOpenChange={(open) => !open && setConfirmTier(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save changes to the {confirmTier} tier?</AlertDialogTitle>
            <AlertDialogDescription>
              This changes the {confirmTier} tier&apos;s quota defaults for future provisioning and re-seed actions. It does NOT
              retroactively change any existing tenant&apos;s live quota — an operator must explicitly re-seed each tenant they
              want updated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmTier(null)}>
              Cancel
            </Button>
            <Button onClick={() => confirmTier && void confirmSave(confirmTier)} disabled={submitting}>
              Save tier
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
