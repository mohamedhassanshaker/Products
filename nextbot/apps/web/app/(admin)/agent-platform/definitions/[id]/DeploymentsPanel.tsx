"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Button } from "@nextbot/ui/components/ui/button";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@nextbot/ui/components/ui/alert-dialog";
import { WARNING_BADGE_CLASS } from "@nextbot/ui/lib/status-badge";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";
import { ShadowEvaluationCard } from "./ShadowEvaluationCard";
import type { DeploymentsPanelVersion } from "./deployments-types";

/**
 * **Deployments & Canary** (Target Architecture Blueprint Phase 17, BL-48/BL-13,
 * FR-AGT-04/05/09/10, ADR-0019, LLD §15.8, UX_GUIDELINES.md §6.8).
 *
 * A TAB on the existing Definition Detail screen — deliberately not a new top-level
 * "Deployment Manager" console area and not a new Agent Platform sub-nav item
 * (ADR-0019 §2.7 rejected both).
 *
 * **Production-only this phase, by design.** `environment` is a real parameter all the
 * way down to `setTrafficSplit`, but only `Production` has a live resolver consumer
 * (ADR-0019 §2.7), so this renders a fixed label rather than a picker with two dead
 * options — the same "omit a dead control" rule §6.7 already applies.
 */

/** Only Production has a live traffic resolver this phase (ADR-0019 §2.7). */
const ENVIRONMENT = "Production" as const;

interface Allocation {
  id: string;
  agentDefinitionVersionId: string;
  trafficSplitPct: number;
  activatedAt: string;
}
interface VersionMetrics {
  agentDefinitionVersionId: string;
  runs: number;
  errorRatePct: number;
  p50Ms: number | null;
  p95Ms: number | null;
  costUsd: number;
}
interface HistoryEntry {
  id: string;
  action: "Deploy" | "SplitChange" | "PromoteCanary" | "Rollback" | "EmergencyRollback";
  agentDefinitionVersionId: string | null;
  fromState: unknown;
  toState: unknown;
  reason: string;
  actorUserId: string | null;
  createdAt: string;
}
/** A row in the editable split. `pct` is local, uncommitted state until Save. */
interface EditableRow {
  versionId: string;
  pct: number;
}

/** `EmergencyRollback` is rendered distinctly from every other action — ADR-0017 §2.5's
 *  "visibility as the compensating control": an audited gate bypass must never be
 *  indistinguishable from an ordinary deployment in the timeline. */
const ACTION_BADGE: Record<HistoryEntry["action"], { variant?: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  Deploy: { variant: "secondary" },
  SplitChange: { variant: "outline" },
  PromoteCanary: { className: "bg-emerald-700 text-white" },
  Rollback: { className: WARNING_BADGE_CLASS },
  EmergencyRollback: { variant: "destructive" },
};

export function DeploymentsPanel({ definitionId, versions, canWrite }: { definitionId: string; versions: DeploymentsPanelVersion[]; canWrite: boolean }) {
  const [allocations, setAllocations] = useState<Allocation[] | null>(null);
  const [metrics, setMetrics] = useState<VersionMetrics[]>([]);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [allocationsError, setAllocationsError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  /** The uncommitted edit. `null` until the first load completes. */
  const [rows, setRows] = useState<EditableRow[] | null>(null);
  const [addVersionId, setAddVersionId] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveReason, setSaveReason] = useState("");
  const [promoteTarget, setPromoteTarget] = useState<EditableRow | null>(null);
  const [promoteReason, setPromoteReason] = useState("");
  const [busy, setBusy] = useState(false);

  const versionLabel = useCallback((versionId: string) => versions.find((v) => v.id === versionId)?.version ?? versionId.slice(0, 8), [versions]);

  const loadAllocations = useCallback(async () => {
    setAllocationsError(null);
    const result = await fetchJson<{ allocations: Allocation[]; metrics: VersionMetrics[] }>(
      `/api/v1/admin/agent-platform/definitions/${definitionId}/deployments?environment=${ENVIRONMENT}`,
    );
    if (result.kind !== "ok") {
      setAllocationsError(result.message);
      setAllocations([]);
      return;
    }
    setAllocations(result.data.allocations);
    setMetrics(result.data.metrics);
    setRows(result.data.allocations.map((a) => ({ versionId: a.agentDefinitionVersionId, pct: a.trafficSplitPct })));
  }, [definitionId]);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    const result = await fetchJson<{ history: HistoryEntry[] }>(`/api/v1/admin/agent-platform/definitions/${definitionId}/deployments/history?environment=${ENVIRONMENT}`);
    if (result.kind !== "ok") {
      setHistoryError(result.message);
      setHistory([]);
      return;
    }
    setHistory(result.data.history);
  }, [definitionId]);

  useEffect(() => {
    void loadAllocations();
    void loadHistory();
  }, [loadAllocations, loadHistory]);

  const total = (rows ?? []).reduce((sum, r) => sum + (Number.isFinite(r.pct) ? r.pct : 0), 0);
  const persisted = (allocations ?? []).map((a) => `${a.agentDefinitionVersionId}:${a.trafficSplitPct}`).sort().join("|");
  const edited = (rows ?? []).map((r) => `${r.versionId}:${r.pct}`).sort().join("|");
  const dirty = persisted !== edited;
  const canSave = canWrite && rows !== null && rows.length > 0 && total === 100 && dirty;

  /**
   * The common two-arm case ("shift 10% to my canary") auto-balances the other row, so
   * the sum-to-100 rule is impossible to violate by construction rather than something
   * the admin has to do arithmetic for. With three or more rows there is no single
   * correct row to absorb the remainder, so the inputs stay independent and the live
   * total below is what guides the admin (UX_GUIDELINES §6.8).
   */
  function setRowPct(index: number, raw: string) {
    setRows((current) => {
      if (!current) return current;
      const pct = Math.max(0, Math.min(100, Number.parseInt(raw, 10) || 0));
      const next = current.map((r, i) => (i === index ? { ...r, pct } : r));
      if (next.length === 2) {
        const other = index === 0 ? 1 : 0;
        next[other] = { ...next[other]!, pct: 100 - pct };
      }
      return next;
    });
  }

  function distributeEvenly() {
    setRows((current) => {
      if (!current || current.length === 0) return current;
      const base = Math.floor(100 / current.length);
      return current.map((r, i) => ({ ...r, pct: i === 0 ? 100 - base * (current.length - 1) : base }));
    });
  }

  function addRow() {
    if (!addVersionId) return;
    setRows((current) => (current ? [...current, { versionId: addVersionId, pct: 0 }] : [{ versionId: addVersionId, pct: 100 }]));
    setAddVersionId("");
  }

  function removeRow(index: number) {
    setRows((current) => (current && current.length > 1 ? current.filter((_, i) => i !== index) : current));
  }

  async function saveSplit() {
    if (!rows) return;
    setBusy(true);
    const result = await fetchJson(`/api/v1/admin/agent-platform/definitions/${definitionId}/deployments`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ environment: ENVIRONMENT, allocations: rows.map((r) => ({ versionId: r.versionId, trafficSplitPct: r.pct })), reason: saveReason }),
    });
    setBusy(false);
    setSaveOpen(false);
    setSaveReason("");
    if (result.kind !== "ok") {
      // The server's own DomainError copy, verbatim (this project's exact-error-copy
      // convention) — then refetch, because the most likely cause of a 409 reaching a
      // client whose Save button was already gated is a concurrent change by someone else.
      toast.error(result.message);
      await loadAllocations();
      return;
    }
    toast.success("Traffic split updated.");
    await Promise.all([loadAllocations(), loadHistory()]);
  }

  async function promoteToFull(versionId: string) {
    setBusy(true);
    const result = await fetchJson(`/api/v1/admin/agent-platform/definitions/${definitionId}/deployments/promote-canary`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ environment: ENVIRONMENT, versionId, reason: promoteReason }),
    });
    setBusy(false);
    setPromoteTarget(null);
    setPromoteReason("");
    if (result.kind !== "ok") {
      toast.error(result.message);
      await loadAllocations();
      return;
    }
    toast.success("Canary promoted to 100%.");
    await Promise.all([loadAllocations(), loadHistory()]);
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="mb-1 flex items-center gap-2">
          <h2 className="font-heading text-base font-semibold">Traffic allocation</h2>
          <Badge variant="secondary">{ENVIRONMENT}</Badge>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Only Production has a live traffic resolver this phase — Staging and Sandbox allocations aren&apos;t yet wired to any live turn.
        </p>

        {allocationsError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              {allocationsError}{" "}
              <Button size="xs" variant="outline" className="ms-2" onClick={() => void loadAllocations()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {rows === null ? (
          <Skeleton className="h-[140px] w-full" role="status" aria-label="Loading traffic allocation" />
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">No active deployment yet — promote a version to Production from the Versions tab to begin.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Traffic %</TableHead>
                  <TableHead>Runs</TableHead>
                  <TableHead>Error rate</TableHead>
                  <TableHead>p50</TableHead>
                  <TableHead>p95</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => {
                  const m = metrics.find((x) => x.agentDefinitionVersionId === row.versionId);
                  return (
                    <TableRow key={row.versionId}>
                      <TableCell>v{versionLabel(row.versionId)}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={row.pct}
                          disabled={!canWrite}
                          aria-label={`Traffic percentage for v${versionLabel(row.versionId)}`}
                          aria-describedby="traffic-split-total"
                          className="w-[90px]"
                          onChange={(e) => setRowPct(index, e.target.value)}
                        />
                      </TableCell>
                      {/* "—" (no data) is deliberately distinct from "0%" (measured zero):
                          a version with no runs yet has said nothing about its health, and
                          rendering that as 0 would read as a measured result. */}
                      <TableCell>{m && m.runs > 0 ? m.runs : "—"}</TableCell>
                      <TableCell>
                        {m && m.runs > 0 ? (
                          // Inverse of the Tool Catalog's "0% success is alarming" rule:
                          // a 0% ERROR rate is the desired outcome, so it renders plain.
                          // Only a meaningfully high rate is accented (>5%, the same
                          // threshold the Agent Tool Registry already uses).
                          <span className={m.errorRatePct > 5 ? "font-medium text-destructive" : undefined}>
                            {m.errorRatePct > 5 ? `⚠ ${m.errorRatePct}%` : `${m.errorRatePct}%`}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{m?.p50Ms != null ? `${m.p50Ms}ms` : "—"}</TableCell>
                      <TableCell>{m?.p95Ms != null ? `${m.p95Ms}ms` : "—"}</TableCell>
                      <TableCell>{m && m.runs > 0 ? `$${m.costUsd.toFixed(4)}` : "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {canWrite && rows.length > 1 && (
                            <Button size="xs" variant="outline" aria-label={`Remove v${versionLabel(row.versionId)} from split`} onClick={() => removeRow(index)}>
                              Remove
                            </Button>
                          )}
                          {canWrite && rows.length > 1 && (
                            <Button
                              size="xs"
                              aria-label={`Promote v${versionLabel(row.versionId)} to 100%`}
                              onClick={() => {
                                setPromoteTarget(row);
                                setPromoteReason("");
                              }}
                            >
                              Promote to 100%
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Stated here and once more inside the confirm dialog — never a third time
                in the success toast. */}
            <p className="mt-2 text-sm text-muted-foreground">
              Changes apply to each conversation&apos;s next turn — conversations mid-turn finish on their current version.
            </p>

            <p id="traffic-split-total" className="mt-2 text-sm" aria-live="polite">
              {total === 100 ? (
                <span className="text-emerald-700">✓ Total: 100% — ready to save</span>
              ) : (
                <span className="font-medium text-amber-800">⚠ Total: {total}% — must equal 100% to save</span>
              )}
            </p>

            {canWrite && (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-1">
                    <Label htmlFor="add-version-to-split" className="text-sm">
                      Add version to split
                    </Label>
                    <FieldHint
                      id="add-version-to-split-hint"
                      content="The percentage of new conversations for this agent in Production that should be routed to each version. All rows must add up to exactly 100%."
                    />
                  </div>
                  <Select value={addVersionId} onValueChange={(v) => v !== null && setAddVersionId(v)}>
                    <SelectTrigger id="add-version-to-split" className="w-[300px]" aria-label="Add version to split">
                      <SelectValue placeholder="Select a version" />
                    </SelectTrigger>
                    <SelectContent>
                      {versions
                        .filter((v) => v.status !== "Deprecated" && !rows.some((r) => r.versionId === v.id))
                        .map((v) => (
                          // Ineligible versions are shown DISABLED rather than hidden —
                          // deliberately different from this screen's emergency-rollback
                          // control, which hides ineligible versions. Here the
                          // ineligibility is one actionable step away ("go promote it"),
                          // not a dead end, so it is worth surfacing (UX_GUIDELINES §6.8).
                          <SelectItem key={v.id} value={v.id} disabled={v.status !== "Production"}>
                            v{v.version} {v.status !== "Production" ? `— ${v.status}: must be promoted to Production before it can receive canary traffic` : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 max-w-[420px] text-xs text-muted-foreground">
                    Only versions already promoted to Production can receive canary traffic — promote one from the Versions tab first.
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={!addVersionId} onClick={addRow}>
                  + Add
                </Button>
                {rows.length > 2 && (
                  <Button size="sm" variant="outline" onClick={distributeEvenly}>
                    Distribute evenly
                  </Button>
                )}
                <Button size="sm" disabled={!canSave} aria-describedby="traffic-split-total" onClick={() => setSaveOpen(true)}>
                  Save split
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-heading text-base font-semibold">Rollout history</h2>
        {historyError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              {historyError}{" "}
              <Button size="xs" variant="outline" className="ms-2" onClick={() => void loadHistory()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {history === null ? (
          <Skeleton className="h-[100px] w-full" role="status" aria-label="Loading rollout history" />
        ) : history.length === 0 ? (
          <p className="text-muted-foreground">No deployment actions recorded yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {history.map((entry) => {
              const badge = ACTION_BADGE[entry.action];
              return (
                <li
                  key={entry.id}
                  className={entry.action === "EmergencyRollback" ? "border-s-4 border-destructive ps-3" : "border-s-4 border-transparent ps-3"}
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={badge.variant} className={badge.className}>
                      {entry.action}
                    </Badge>
                    {entry.agentDefinitionVersionId && <span>v{versionLabel(entry.agentDefinitionVersionId)}</span>}
                    <span className="text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{entry.reason}</p>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <ShadowEvaluationCard definitionId={definitionId} versions={versions} canWrite={canWrite} />

      <AlertDialog
        open={saveOpen}
        onOpenChange={(open) => {
          setSaveOpen(open);
          if (!open) setSaveReason("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save this traffic split?</AlertDialogTitle>
            <AlertDialogDescription>
              {(rows ?? []).map((r) => `v${versionLabel(r.versionId)} ${r.pct}%`).join(" / ")} in Production. Every allocated version must already be promoted to
              Production — a canary is never a way past the promotion gate. Like every split change, this takes effect on each conversation&apos;s <em>next</em>{" "}
              turn — already-in-progress turns finish on their current version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mb-2">
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="split-reason" className="text-xs">
                Reason (required)
              </Label>
              <FieldHint
                id="split-reason-hint"
                content="A non-blank reason is required for every split change and canary promotion — it's written to the audit log (deployment_history plus the transactional outbox) alongside the actor and the resulting allocations."
              />
            </div>
            <Textarea
              id="split-reason"
              value={saveReason}
              onChange={(e) => setSaveReason(e.target.value)}
              placeholder="e.g. Starting a 10% canary on v2.1.0 after a clean eval run."
              aria-required="true"
            />
          </div>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || saveReason.trim().length === 0} onClick={() => void saveSplit()}>
              {busy ? "Saving…" : "Confirm split change"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={promoteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPromoteTarget(null);
            setPromoteReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Promote v{promoteTarget ? versionLabel(promoteTarget.versionId) : ""} to 100%?</AlertDialogTitle>
            <AlertDialogDescription>
              This ends the current split and sends all Production traffic for this agent to this version, deactivating the other arms. Like every split change,
              it takes effect on each conversation&apos;s <em>next</em> turn — already-in-progress turns finish on their current version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mb-2">
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="promote-canary-reason" className="text-xs">
                Reason (required)
              </Label>
              <FieldHint
                id="promote-canary-reason-hint"
                content="A non-blank reason is required for every split change and canary promotion — it's written to the audit log (deployment_history plus the transactional outbox) alongside the actor and the resulting allocations."
              />
            </div>
            <Textarea
              id="promote-canary-reason"
              value={promoteReason}
              onChange={(e) => setPromoteReason(e.target.value)}
              placeholder="e.g. Canary held a 0% error rate at 10% of traffic for 48 hours."
              aria-required="true"
            />
          </div>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setPromoteTarget(null)}>
              Cancel
            </Button>
            <Button disabled={busy || promoteReason.trim().length === 0} onClick={() => promoteTarget && void promoteToFull(promoteTarget.versionId)}>
              {busy ? "Promoting…" : "Confirm promotion to 100%"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
