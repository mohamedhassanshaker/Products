"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Button } from "@nextbot/ui/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@nextbot/ui/components/ui/card";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Progress } from "@nextbot/ui/components/ui/progress";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@nextbot/ui/components/ui/alert-dialog";
import { WARNING_BADGE_CLASS } from "@nextbot/ui/lib/status-badge";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";
import type { DeploymentsPanelVersion } from "./deployments-types";

/**
 * **Shadow evaluation** (Target Architecture Blueprint Phase 17, BL-48, ADR-0019 §2.5/§2.6,
 * LLD §15.8, UX_GUIDELINES.md §6.8 Surface 2).
 *
 * Two properties shape every control on this card, and both are load-bearing rather than
 * cosmetic:
 *
 * 1. **Results are evidence, never a gate.** No control here may look like — or be — a
 *    promote/apply/adopt action, and the aggregate stats render in plain, neutral styling
 *    with no green/red pass-fail treatment, precisely so a low divergence figure cannot be
 *    mistaken for a "passed" badge. Promotion still happens through the ordinary gate on
 *    the Versions tab. The "Evidence only" caption is persistent and non-dismissible: a
 *    dismissible one would be gone exactly on the day a result looks encouraging enough
 *    to want to act on.
 * 2. **Starting one spends real money on real customer content.** A shadow run re-sends a
 *    sample of real conversations to the candidate's model, through the same Model Gateway
 *    with the same residency governance. The start confirmation says so in three scannable
 *    bullets rather than burying it, and the three ceilings are required inputs.
 *
 * The candidate-version picker deliberately allows **every** non-Deprecated version
 * regardless of status — the exact opposite of the canary split editor's Production-only
 * rule. That is the point of the feature: gather evidence about a *pre-promotion*
 * candidate with zero customer exposure.
 */

const ENVIRONMENT = "Production" as const;
/** Deliberately looser than the worker's own 5s pump cadence — this is an admin console
 *  view, not a mirror of backend internals, and a calmer poll keeps the `aria-live`
 *  counters usable rather than chatty. */
const POLL_INTERVAL_MS = 12_000;

type ShadowEvaluationStatus = "Active" | "Stopped" | "Completed" | "AutoStopped";

interface ShadowEvaluation {
  id: string;
  candidateVersionId: string;
  environment: string;
  status: ShadowEvaluationStatus;
  samplePct: number;
  maxRuns: number;
  maxCostUsd: string;
  runsEnqueued: number;
  runsCompleted: number;
  spendUsd: string;
  stopReason: string | null;
  createdAt: string;
}

interface ShadowReport {
  evaluation: ShadowEvaluation;
  completedRuns: number;
  skippedRuns: number;
  failedRuns: number;
  replyDivergencePct: number | null;
  toolCallDivergencePct: number | null;
  escalationRatePct: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  totalCostUsd: number;
}

interface ShadowToolCall {
  toolName: string;
  argsMasked: Record<string, unknown>;
  tier: string | null;
  outcome: "Executed(shadow-noop)" | "ShadowSuppressed" | "PolicyDenied";
}

interface ShadowRun {
  id: string;
  status: "Pending" | "Claimed" | "Completed" | "Failed" | "Skipped";
  skipReason: "SourceGone" | "QuotaDeferredTooLong" | "EvaluationStopped" | null;
  durationMs: number | null;
  costUsd: string | null;
  replyText: string | null;
  replyPayloadHash: string | null;
  liveReplyPayloadHash: string | null;
  wouldHaveToolCalls: ShadowToolCall[] | null;
  escalationSignal: unknown;
  guardrailOutcome: unknown;
  shadowAgentRunId: string | null;
  createdAt: string;
}

/** Lifecycle, not quality — none of the four is a verdict on the candidate.
 *  `Completed` is deliberately styled identically to `Stopped`: nothing in this build
 *  ever writes it (the repository only produces `Stopped` and `AutoStopped`), so
 *  designing a visual distinction for it would be designing for a state nothing
 *  produces — the same call §6.7 already makes for `PausedForApproval`. */
const EVALUATION_BADGE: Record<ShadowEvaluationStatus, { variant?: "default" | "secondary" | "outline" | "destructive"; className?: string; label: string }> = {
  Active: { className: "bg-blue-700 text-white", label: "In progress" },
  Stopped: { variant: "secondary", label: "Stopped by admin" },
  Completed: { variant: "secondary", label: "Completed" },
  AutoStopped: { className: WARNING_BADGE_CLASS, label: "Auto-stopped" },
};

/** All three outcomes share ONE neutral tone and are distinguished by text and icon
 *  alone — deliberately not a red/green/amber traffic light. None of them is a failure:
 *  "the candidate would have required Tier-3 approval for `issue_refund`" is precisely
 *  the finding a reviewer opened this screen to see. */
const TOOL_OUTCOME_LABEL: Record<ShadowToolCall["outcome"], { icon: string; label: (tier: string | null) => string; title: string }> = {
  "Executed(shadow-noop)": {
    icon: "◇",
    label: () => "Would have executed (no-op)",
    title: "This Tier-1 tool call was validated against its schema but never actually sent — shadow runs can't reach a real tool.",
  },
  ShadowSuppressed: {
    icon: "◈",
    label: (tier) => `Would have required ${tier ?? "approval"} approval`,
    title: "In a live run this call would have required human or customer approval before executing. No approval request was created, since this is a shadow evaluation.",
  },
  PolicyDenied: {
    icon: "◆",
    label: () => "Would have been denied by policy",
    title: "Tool-permission policy would have denied this call outright in a live run.",
  },
};

/** A skipped run is a normal, expected outcome — most often retention/DSR doing its job —
 *  and must never render in the same red tone as a genuine `Failed`. */
const SKIP_REASON_TEXT: Record<NonNullable<ShadowRun["skipReason"]>, string> = {
  SourceGone: "Skipped — source conversation no longer available (purged by retention)",
  QuotaDeferredTooLong: "Skipped — repeatedly deferred by quota pressure",
  EvaluationStopped: "Skipped — the evaluation was stopped before this run executed",
};

export function ShadowEvaluationCard({ definitionId, versions, canWrite }: { definitionId: string; versions: DeploymentsPanelVersion[]; canWrite: boolean }) {
  const [evaluations, setEvaluations] = useState<ShadowEvaluation[] | null>(null);
  const [report, setReport] = useState<ShadowReport | null>(null);
  const [runs, setRuns] = useState<ShadowRun[] | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startOpen, setStartOpen] = useState(false);
  const [candidateVersionId, setCandidateVersionId] = useState("");
  const [samplePct, setSamplePct] = useState("");
  const [maxRuns, setMaxRuns] = useState("");
  const [maxCostUsd, setMaxCostUsd] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopReason, setStopReason] = useState("");
  const [busy, setBusy] = useState(false);

  const versionLabel = useCallback((id: string) => versions.find((v) => v.id === id)?.version ?? id.slice(0, 8), [versions]);

  const current = evaluations?.[0] ?? null;

  const load = useCallback(async () => {
    const result = await fetchJson<{ evaluations: ShadowEvaluation[] }>(`/api/v1/admin/agent-platform/definitions/${definitionId}/shadow-evaluations`);
    if (result.kind !== "ok") {
      setError(result.message);
      setEvaluations([]);
      return;
    }
    setError(null);
    setEvaluations(result.data.evaluations);
    const latest = result.data.evaluations[0];
    if (!latest) {
      setReport(null);
      return;
    }
    const reportResult = await fetchJson<ShadowReport>(`/api/v1/admin/agent-platform/definitions/${definitionId}/shadow-evaluations/${latest.id}`);
    if (reportResult.kind === "ok") setReport(reportResult.data);
  }, [definitionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while an experiment is genuinely running — a stopped one's numbers are
  // frozen, so continuing to poll would be pure noise.
  useEffect(() => {
    if (current?.status !== "Active") return;
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [current?.status, load]);

  async function loadRuns(evaluationId: string) {
    setShowRuns(true);
    setRuns(null);
    const result = await fetchJson<{ runs: ShadowRun[] }>(`/api/v1/admin/agent-platform/definitions/${definitionId}/shadow-evaluations/${evaluationId}/runs`);
    setRuns(result.kind === "ok" ? result.data.runs : []);
  }

  const samplePctNum = Number.parseInt(samplePct, 10);
  const maxRunsNum = Number.parseInt(maxRuns, 10);
  const maxCostNum = Number.parseFloat(maxCostUsd);
  const startInputsValid =
    candidateVersionId !== "" && Number.isInteger(samplePctNum) && samplePctNum >= 1 && samplePctNum <= 100 && Number.isInteger(maxRunsNum) && maxRunsNum > 0 && maxCostNum > 0;

  async function startEvaluation() {
    setBusy(true);
    const result = await fetchJson(`/api/v1/admin/agent-platform/definitions/${definitionId}/shadow-evaluations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ environment: ENVIRONMENT, candidateVersionId, samplePct: samplePctNum, maxRuns: maxRunsNum, maxCostUsd: maxCostNum }),
    });
    setBusy(false);
    setConfirmOpen(false);
    if (result.kind !== "ok") {
      // Verbatim server copy — `409 ALREADY_ACTIVE` is a genuinely reachable race (two
      // admins, or a stale page), so refetch and show whichever one is already running.
      toast.error(result.message);
      await load();
      return;
    }
    setStartOpen(false);
    setCandidateVersionId("");
    setSamplePct("");
    setMaxRuns("");
    setMaxCostUsd("");
    toast.success("Shadow evaluation started.");
    await load();
  }

  async function stopEvaluation(id: string) {
    setBusy(true);
    const result = await fetchJson(`/api/v1/admin/agent-platform/definitions/${definitionId}/shadow-evaluations/${id}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: stopReason }),
    });
    setBusy(false);
    setStopOpen(false);
    setStopReason("");
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Shadow evaluation stopped.");
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shadow evaluation</CardTitle>
        {/* Persistent and non-dismissible, in every state. */}
        <CardDescription>Evidence only — does not affect what&apos;s deployed.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error}{" "}
              <Button size="xs" variant="outline" className="ms-2" onClick={() => void load()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {evaluations === null ? (
          <Skeleton className="h-[100px] w-full" role="status" aria-label="Loading shadow evaluation" />
        ) : current === null ? (
          <p className="text-muted-foreground">No shadow evaluation has been run for this agent in Production.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={EVALUATION_BADGE[current.status].variant} className={EVALUATION_BADGE[current.status].className}>
                {EVALUATION_BADGE[current.status].label}
              </Badge>
              <span>
                Candidate v{versionLabel(current.candidateVersionId)} · sampling {current.samplePct}% of Production turns
              </span>
              {current.stopReason && <span className="text-muted-foreground">— {current.stopReason}</span>}
            </div>

            <div className="flex flex-col gap-2" aria-live="polite">
              <div>
                <p className="text-sm">
                  ${Number(current.spendUsd).toFixed(4)} of ${Number(current.maxCostUsd).toFixed(2)} spent
                </p>
                <Progress value={Math.min(100, (Number(current.spendUsd) / Number(current.maxCostUsd)) * 100)} aria-label="Shadow evaluation spend against its cost ceiling" />
              </div>
              <div>
                <p className="text-sm">
                  {current.runsCompleted} of {current.maxRuns} runs
                </p>
                <Progress value={Math.min(100, (current.runsCompleted / current.maxRuns) * 100)} aria-label="Shadow evaluation completed runs against its run ceiling" />
              </div>
              <p className="text-xs text-muted-foreground">{Math.max(0, current.runsEnqueued - current.runsCompleted)} enqueued, not yet completed</p>
            </div>

            {report && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Comparison against live traffic</h3>
                {/* Plain, neutral styling on purpose — a measurement, not a verdict. */}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
                  <Stat label="Completed runs" value={String(report.completedRuns)} />
                  <Stat label="Skipped" value={String(report.skippedRuns)} />
                  <Stat label="Failed" value={String(report.failedRuns)} />
                  <Stat label="Reply divergence" value={report.replyDivergencePct === null ? "—" : `${report.replyDivergencePct}%`} />
                  <Stat label="Tool-call divergence" value={report.toolCallDivergencePct === null ? "—" : `${report.toolCallDivergencePct}%`} />
                  <Stat label="Escalation rate" value={report.escalationRatePct === null ? "—" : `${report.escalationRatePct}%`} />
                  <Stat label="Candidate p50" value={report.p50Ms === null ? "—" : `${report.p50Ms}ms`} />
                  <Stat label="Candidate p95" value={report.p95Ms === null ? "—" : `${report.p95Ms}ms`} />
                  <Stat label="Candidate spend" value={`$${report.totalCostUsd.toFixed(4)}`} />
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">
                  Promotion happens from the Versions tab — a good result here doesn&apos;t change what&apos;s required there.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void loadRuns(current.id)}>
                View runs
              </Button>
              {canWrite && current.status === "Active" && (
                <Button size="sm" variant="outline" onClick={() => setStopOpen(true)}>
                  Stop…
                </Button>
              )}
            </div>

            {showRuns && (
              <div>
                {runs === null ? (
                  <Skeleton className="h-[80px] w-full" role="status" aria-label="Loading shadow runs" />
                ) : runs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No runs yet — the pump enqueues a shadow run on the next matching live turn.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Cost</TableHead>
                        <TableHead>Reply</TableHead>
                        <TableHead>Would-be tool calls</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell>
                            <RunStatus run={run} />
                          </TableCell>
                          <TableCell>{run.durationMs === null ? "—" : `${run.durationMs}ms`}</TableCell>
                          <TableCell>{run.costUsd === null ? "—" : `$${Number(run.costUsd).toFixed(6)}`}</TableCell>
                          <TableCell>
                            {run.replyPayloadHash === null ? (
                              "—"
                            ) : run.replyPayloadHash === run.liveReplyPayloadHash ? (
                              <span className="text-muted-foreground">Identical to live</span>
                            ) : (
                              <span>Differs from live</span>
                            )}
                            {run.escalationSignal != null && (
                              <span className="ms-2 text-xs text-muted-foreground" title="Escalation signal captured (not acted on)">
                                ⓘ escalation signal captured
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {(run.wouldHaveToolCalls ?? []).length === 0 ? (
                              <span className="text-muted-foreground">None</span>
                            ) : (
                              <ul className="flex flex-col gap-1">
                                {(run.wouldHaveToolCalls ?? []).map((call, i) => {
                                  const outcome = TOOL_OUTCOME_LABEL[call.outcome];
                                  return (
                                    <li key={i} className="text-xs" title={outcome.title}>
                                      <code>{call.toolName}</code> — <span aria-hidden="true">{outcome.icon} </span>
                                      {outcome.label(call.tier)}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </>
        )}

        {canWrite && (current === null || current.status !== "Active") && (
          <div>
            {!startOpen ? (
              <Button size="sm" onClick={() => setStartOpen(true)}>
                Start shadow evaluation…
              </Button>
            ) : (
              <div className="flex flex-col gap-3 rounded-md border p-4">
                <div>
                  <div className="mb-1 flex items-center gap-1">
                    <Label htmlFor="shadow-candidate" className="text-sm">
                      Candidate version
                    </Label>
                    <FieldHint
                      id="shadow-candidate-hint"
                      content="Any version of this agent can be shadow-evaluated, including a Draft — that is the point: it gathers evidence about a pre-promotion candidate with zero customer exposure."
                    />
                  </div>
                  <Select value={candidateVersionId} onValueChange={(v) => v !== null && setCandidateVersionId(v)}>
                    <SelectTrigger id="shadow-candidate" className="w-[300px]" aria-label="Candidate version">
                      <SelectValue placeholder="Select a version" />
                    </SelectTrigger>
                    <SelectContent>
                      {versions
                        .filter((v) => v.status !== "Deprecated")
                        .map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            v{v.version} — {v.status}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap gap-4">
                  <div>
                    <div className="mb-1 flex items-center gap-1">
                      <Label htmlFor="shadow-sample-pct" className="text-sm">
                        Sample %
                      </Label>
                      <FieldHint
                        id="shadow-sample-pct-hint"
                        content="The percentage of live Production turns for this agent that are also replayed against the candidate, off the customer-facing path. Higher sampling produces evidence faster and costs more."
                      />
                    </div>
                    <Input id="shadow-sample-pct" type="number" min={1} max={100} placeholder="e.g. 10" value={samplePct} onChange={(e) => setSamplePct(e.target.value)} className="w-[120px]" />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-1">
                      <Label htmlFor="shadow-max-runs" className="text-sm">
                        Max runs
                      </Label>
                      <FieldHint id="shadow-max-runs-hint" content="Hard ceiling — the evaluation automatically stops once this many candidate runs complete, regardless of cost spent." />
                    </div>
                    <Input id="shadow-max-runs" type="number" min={1} value={maxRuns} onChange={(e) => setMaxRuns(e.target.value)} className="w-[120px]" />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-1">
                      <Label htmlFor="shadow-max-cost" className="text-sm">
                        Max cost (USD)
                      </Label>
                      <FieldHint
                        id="shadow-max-cost-hint"
                        content="Hard ceiling — the evaluation automatically stops once total candidate spend reaches this amount, regardless of run count."
                      />
                    </div>
                    <Input id="shadow-max-cost" type="number" min={0} step="0.01" value={maxCostUsd} onChange={(e) => setMaxCostUsd(e.target.value)} className="w-[140px]" />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setStartOpen(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={!startInputsValid} onClick={() => setConfirmOpen(true)}>
                    Start
                  </Button>
                </div>
                {!startInputsValid && <p className="text-xs text-muted-foreground">Choose a candidate version, a sample percentage between 1 and 100, and both ceilings above zero.</p>}
              </div>
            )}
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start shadow evaluation for v{candidateVersionId ? versionLabel(candidateVersionId) : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="mb-2 block">
                This resends a sample of real customer conversations to this version&apos;s model a second time, off the customer-facing path. It never reaches a
                real tool, is never shown to any customer, and never creates an approval request.
              </span>
              <span className="mb-2 block">
                This is genuine model-provider spend — billed and reported like any other run. Sampling {samplePct}% of turns, capped at {maxRuns} runs or $
                {maxCostUsd}, whichever comes first.
              </span>
              <span className="block">
                This is evidence only — it does not change which version is currently serving traffic, and a good result here does not shorten or skip the
                promotion gate.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void startEvaluation()}>
              {busy ? "Starting…" : "Start shadow evaluation"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={stopOpen}
        onOpenChange={(open) => {
          setStopOpen(open);
          if (!open) setStopReason("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this shadow evaluation?</AlertDialogTitle>
            <AlertDialogDescription>In-flight replays already claimed by the worker will finish; nothing new will be enqueued after this.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mb-2">
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="shadow-stop-reason" className="text-xs">
                Reason (required)
              </Label>
              <FieldHint id="shadow-stop-reason-hint" content="Written to the audit log alongside the evaluation's final counters." />
            </div>
            <Textarea id="shadow-stop-reason" value={stopReason} onChange={(e) => setStopReason(e.target.value)} aria-required="true" />
          </div>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setStopOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || stopReason.trim().length === 0} onClick={() => current && void stopEvaluation(current.id)}>
              {busy ? "Stopping…" : "Confirm stop"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** `Skipped` is neutral, never `Failed`'s red: a purged source conversation is retention
 *  and DSR policy doing its job, not a defect in the shadow run. */
function RunStatus({ run }: { run: ShadowRun }) {
  if (run.status === "Pending" || run.status === "Claimed") {
    return <Badge variant="secondary">Queued</Badge>;
  }
  if (run.status === "Failed") {
    return <Badge variant="destructive">Failed</Badge>;
  }
  if (run.status === "Skipped") {
    return (
      <span className="text-xs text-muted-foreground">
        <Badge variant="secondary">Skipped</Badge> {run.skipReason ? SKIP_REASON_TEXT[run.skipReason] : ""}
      </span>
    );
  }
  return <Badge variant="outline">Completed</Badge>;
}
