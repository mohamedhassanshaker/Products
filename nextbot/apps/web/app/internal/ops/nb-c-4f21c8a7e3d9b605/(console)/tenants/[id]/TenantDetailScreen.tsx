"use client";

import { useCallback, useEffect, useState } from "react";
import NextLink from "next/link";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { WARNING_BADGE_CLASS } from "@nextbot/ui/lib/status-badge";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Card } from "@nextbot/ui/components/ui/card";
import { Button } from "@nextbot/ui/components/ui/button";
import { Label } from "@nextbot/ui/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
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

type TenantStatus = "Active" | "Suspended" | "Trial";
type TenantPlanTier = "Starter" | "Growth" | "Enterprise";

interface TenantOperatorSummaryDto {
  id: string;
  name: string;
  slug: string;
  region: string;
  status: TenantStatus;
  planTier: TenantPlanTier;
  defaultLanguage: string;
  createdAt: string;
  isDedicatedDatabase: boolean;
  dataPolicy: {
    retentionTranscriptsDays: number;
    retentionToolPayloadsDays: number;
    retentionToolMetadataDays: number;
    retentionPiiDays: number;
    residencyRegion: string;
  } | null;
  runtimeQuota: {
    maxConcurrentRuns: number | null;
    maxTokensPerMinute: number | null;
    maxToolCallsPerSecond: number | null;
    maxConcurrentConversations: number | null;
    maxMcpConnectors: number | null;
  } | null;
  liveConcurrentRuns: number;
}

const STATUS_BADGE: Record<TenantStatus, { variant?: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  Active: { className: "bg-emerald-700 text-white" },
  Trial: { variant: "secondary" },
  Suspended: { className: WARNING_BADGE_CLASS },
};

const STATUSES: TenantStatus[] = ["Active", "Suspended", "Trial"];
const PLAN_TIERS: TenantPlanTier[] = ["Starter", "Growth", "Enterprise"];

function formatDays(days: number): string {
  return days === -1 ? "Indefinite" : `${days} days`;
}

function formatCap(value: number | null): string {
  return value === null ? "No cap" : String(value);
}

/**
 * Platform Manager console Tenant Detail (NFR-11). Phase 2 adds three consequential
 * mutation actions, each gated behind its own confirm dialog so a status/plan-tier
 * change or a quota overwrite can never happen from a single accidental click:
 *
 *  1. Status change (`PATCH .../status`).
 *  2. Plan-tier *label* change (`PATCH .../plan-tier`) — never touches the live
 *     quota, per the plan's explicit requirement.
 *  3. "Re-seed quota from tier defaults" (`POST .../plan-tier/reseed-quota`) — a
 *     fully separate action/endpoint from #2, so relabeling never silently
 *     overwrites a hand-tuned quota.
 */
export function TenantDetailScreen({ tenantId }: { tenantId: string }) {
  const [summary, setSummary] = useState<TenantOperatorSummaryDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingStatus, setPendingStatus] = useState<TenantStatus | null>(null);
  const [pendingPlanTier, setPendingPlanTier] = useState<TenantPlanTier | null>(null);
  const [confirmAction, setConfirmAction] = useState<"status" | "plan-tier" | "reseed-quota" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchJson<TenantOperatorSummaryDto>(`/api/internal/ops/tenants/${tenantId}`);
    if (result.kind === "error" && result.status === 404) {
      setNotFound(true);
      return;
    }
    if (result.kind === "forbidden" || result.kind === "error") {
      setError(result.message);
      return;
    }
    setSummary(result.data);
    setPendingStatus(result.data.status);
    setPendingPlanTier(result.data.planTier);
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmStatusChange() {
    if (!pendingStatus) return;
    setSubmitting(true);
    const result = await fetchJson(`/api/internal/ops/tenants/${tenantId}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: pendingStatus }),
    });
    setSubmitting(false);
    setConfirmAction(null);
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Tenant status updated.");
    await load();
  }

  async function confirmPlanTierChange() {
    if (!pendingPlanTier) return;
    setSubmitting(true);
    const result = await fetchJson(`/api/internal/ops/tenants/${tenantId}/plan-tier`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planTier: pendingPlanTier }),
    });
    setSubmitting(false);
    setConfirmAction(null);
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Plan tier label updated. Quota was not changed.");
    await load();
  }

  async function confirmReseedQuota() {
    setSubmitting(true);
    const result = await fetchJson(`/api/internal/ops/tenants/${tenantId}/plan-tier/reseed-quota`, { method: "POST" });
    setSubmitting(false);
    setConfirmAction(null);
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Quota re-seeded from tier defaults.");
    await load();
  }

  if (notFound) {
    return <p className="text-muted-foreground">No tenant found with this id.</p>;
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!summary) {
    return <Skeleton className="h-8 w-64" role="status" aria-label="Loading tenant" />;
  }

  const statusBadge = STATUS_BADGE[summary.status];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="font-heading text-lg font-semibold">{summary.name}</h1>
        <Badge variant={statusBadge.variant} className={statusBadge.className}>
          {summary.status}
        </Badge>
      </div>

      {/* Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09). */}
      <NextLink href={`/internal/ops/tenants/${tenantId}/breakglass`} className="text-primary underline-offset-4 hover:underline">
        Break-Glass Access
      </NextLink>

      <Card className="p-4">
        <h2 className="mb-2 font-heading text-base font-semibold">Overview</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">Slug</dt>
          <dd>{summary.slug}</dd>
          <dt className="text-muted-foreground">Region</dt>
          <dd>{summary.region}</dd>
          <dt className="text-muted-foreground">Plan tier</dt>
          <dd>{summary.planTier}</dd>
          <dt className="text-muted-foreground">Default language</dt>
          <dd>{summary.defaultLanguage}</dd>
          <dt className="text-muted-foreground">Dedicated database</dt>
          <dd>{summary.isDedicatedDatabase ? "Yes" : "No"}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{new Date(summary.createdAt).toLocaleString()}</dd>
        </dl>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 font-heading text-base font-semibold">Status &amp; plan tier</h2>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div>
            <Label htmlFor="tenant-status-select">Status</Label>
            <Select value={pendingStatus ?? summary.status} onValueChange={(v) => setPendingStatus(v as TenantStatus)}>
              <SelectTrigger id="tenant-status-select" aria-label="Status" className="mt-1 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" disabled={submitting} onClick={() => setConfirmAction("status")}>
            Change status
          </Button>

          <div>
            <Label htmlFor="tenant-plan-tier-select">Plan tier</Label>
            <Select value={pendingPlanTier ?? summary.planTier} onValueChange={(v) => setPendingPlanTier(v as TenantPlanTier)}>
              <SelectTrigger id="tenant-plan-tier-select" aria-label="Plan tier" className="mt-1 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAN_TIERS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" disabled={submitting} onClick={() => setConfirmAction("plan-tier")}>
            Change plan tier
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Changing the plan tier only updates its label — it never rewrites this tenant&apos;s live quota numbers below.
        </p>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 font-heading text-base font-semibold">Live quota gauge</h2>
        <p className="text-sm">
          Concurrent runs: {summary.liveConcurrentRuns}
          {summary.runtimeQuota?.maxConcurrentRuns !== null && summary.runtimeQuota
            ? ` / ${summary.runtimeQuota.maxConcurrentRuns}`
            : " (no cap)"}
        </p>
      </Card>

      {summary.runtimeQuota && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-heading text-base font-semibold">Runtime quota</h2>
            <Button variant="outline" size="sm" disabled={submitting} onClick={() => setConfirmAction("reseed-quota")}>
              Re-seed quota from tier defaults
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Max concurrent runs</dt>
            <dd>{formatCap(summary.runtimeQuota.maxConcurrentRuns)}</dd>
            <dt className="text-muted-foreground">Max tokens/min</dt>
            <dd>{formatCap(summary.runtimeQuota.maxTokensPerMinute)}</dd>
            <dt className="text-muted-foreground">Max tool calls/sec</dt>
            <dd>{formatCap(summary.runtimeQuota.maxToolCallsPerSecond)}</dd>
            <dt className="text-muted-foreground">Max concurrent conversations</dt>
            <dd>{formatCap(summary.runtimeQuota.maxConcurrentConversations)}</dd>
            <dt className="text-muted-foreground">Max MCP connectors</dt>
            <dd>{formatCap(summary.runtimeQuota.maxMcpConnectors)}</dd>
          </dl>
        </Card>
      )}

      {summary.dataPolicy && (
        <Card className="p-4">
          <h2 className="mb-2 font-heading text-base font-semibold">Data retention policy</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Transcripts</dt>
            <dd>{formatDays(summary.dataPolicy.retentionTranscriptsDays)}</dd>
            <dt className="text-muted-foreground">Tool payloads</dt>
            <dd>{formatDays(summary.dataPolicy.retentionToolPayloadsDays)}</dd>
            <dt className="text-muted-foreground">Tool metadata</dt>
            <dd>{formatDays(summary.dataPolicy.retentionToolMetadataDays)}</dd>
            <dt className="text-muted-foreground">PII</dt>
            <dd>{formatDays(summary.dataPolicy.retentionPiiDays)}</dd>
            <dt className="text-muted-foreground">Residency region</dt>
            <dd>{summary.dataPolicy.residencyRegion}</dd>
          </dl>
        </Card>
      )}

      <AlertDialog open={confirmAction === "status"} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change tenant status to &quot;{pendingStatus}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This changes {summary.name}&apos;s lifecycle status immediately. Suspending a tenant stops it from being picked up by
              scheduled background jobs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmStatusChange()} disabled={submitting}>
              Confirm status change
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAction === "plan-tier"} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change plan tier to &quot;{pendingPlanTier}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This only relabels {summary.name}&apos;s plan tier. It will NOT change this tenant&apos;s current quota numbers — use
              &quot;Re-seed quota from tier defaults&quot; separately if you want to apply the new tier&apos;s defaults.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmPlanTierChange()} disabled={submitting}>
              Confirm plan tier change
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAction === "reseed-quota"} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-seed quota from tier defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              This will OVERWRITE {summary.name}&apos;s current quota numbers (max concurrent conversations, max tool calls/sec, max
              MCP connectors) with the {summary.planTier} tier&apos;s current defaults. Any hand-tuning done for this tenant will be
              lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmReseedQuota()} disabled={submitting}>
              Overwrite quota
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
