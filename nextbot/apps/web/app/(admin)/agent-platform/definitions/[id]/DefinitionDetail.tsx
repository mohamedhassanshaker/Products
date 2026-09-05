"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { Button, buttonVariants } from "@nextbot/ui/components/ui/button";
import { cn } from "@nextbot/ui/lib/utils";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { WARNING_BADGE_CLASS } from "@nextbot/ui/lib/status-badge";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Tooltip, TooltipTrigger, TooltipContent } from "@nextbot/ui/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@nextbot/ui/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@nextbot/ui/components/ui/alert-dialog";
import { Label } from "@nextbot/ui/components/ui/label";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nextbot/ui/components/ui/tabs";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";
import { DeploymentsPanel } from "./DeploymentsPanel";

type AgentVersionStatus = "Draft" | "EvalGated" | "HumanReview" | "Approved" | "Production" | "Deprecated";

interface VersionListItem {
  id: string;
  version: string;
  status: AgentVersionStatus;
  graphType: string;
  gitCommitSha: string | null;
  gitPrNumber: number | null;
  gitPrStatus: "None" | "Open" | "Merged" | "Closed";
  lastEvalRunId: string | null;
  /** U7 fix (QA 2026-08-15 UI pass, low) — the actual outcome of the last eval run, so
   * `EvalBadge` can distinguish "ran and passed"/"ran and failed" from a flat "Ran". */
  lastEvalRunStatus?: "Queued" | "Running" | "Passed" | "Failed" | "Error" | null;
  createdAt: string;
  _allowedTransitions: AgentVersionStatus[];
  /** Phase 7 (client-feedback-batch item 6) — `null` until a real sandbox
   * conversation turn has completed against this version at least once; gates
   * `Approved -> Production` (see `promotion-policy.ts`). */
  lastSandboxTestAt?: string | null;
  /** Phase 6 (BL-27, ADR-0017) — a UI hint only (see `agent-definition-service.ts`'s
   * doc comment); the server re-derives this fact independently on every emergency-
   * rollback call and never trusts this flag. */
  _emergencyRollbackEligible?: boolean;
}

/** Status→Badge treatment. Beyond the four built-in `Badge` variants
 * (default/secondary/outline/destructive), a status needing a distinct hue gets an
 * explicit, pre-verified WCAG AA-passing solid pairing (this codebase's established
 * convention — see `TakeoverPanel.tsx`'s `emerald-700`/white status Badge). */
const STATUS_BADGE: Record<AgentVersionStatus, { variant?: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  Draft: { variant: "secondary" },
  // QA fix (Batch D retry 1): amber-600/white failed WCAG AA (~3.19:1) — see
  // `WARNING_BADGE_CLASS`'s doc comment for the verified replacement/rationale.
  EvalGated: { className: WARNING_BADGE_CLASS },
  HumanReview: { className: "bg-orange-800 text-white" },
  Approved: { className: "bg-blue-700 text-white" },
  Production: { className: "bg-emerald-700 text-white" },
  Deprecated: { variant: "destructive" },
};

/** BL-07 Definition Detail (UX_GUIDELINES.md §6.1/§6.4). Renders the Versions table
 * with the resolved "Promote to…" split (menu hides unavailable targets; a separate
 * always-visible "(?)" affordance explains why the *next* step is blocked, fetched
 * on demand from the `promotion-check` endpoint per §6.4's flagged new-endpoint
 * recommendation). */
export function DefinitionDetail({ definitionId, canWrite }: { definitionId: string; canWrite: boolean }) {
  const [name, setName] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gitConnected, setGitConnected] = useState<boolean | null>(null);

  async function load() {
    const [defResult, versionsResult, gitResult] = await Promise.all([
      fetchJson<{ definition: { name: string } }>(`/api/v1/admin/agent-platform/definitions/${definitionId}`),
      fetchJson<{ versions: VersionListItem[] }>(`/api/v1/admin/agent-platform/definitions/${definitionId}/versions`),
      fetchJson<{ connection: { status: string } | null }>(`/api/v1/admin/agent-platform/git/connection`),
    ]);
    if (defResult.kind === "ok") setName(defResult.data.definition.name);
    if (versionsResult.kind === "ok") setVersions(versionsResult.data.versions);
    else if (versionsResult.kind === "error") setError(versionsResult.message);
    if (gitResult.kind === "ok") setGitConnected(gitResult.data.connection?.status === "Connected");
  }

  useEffect(() => {
    void load();
  }, [definitionId]);

  async function promote(versionId: string, target: AgentVersionStatus) {
    const result = await fetchJson<{ version: VersionListItem }>(`/api/v1/admin/agent-platform/versions/${versionId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetStatus: target }),
    });
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    await load();
  }

  /** ADR-0017 — repoints Production traffic to `versionId` directly, bypassing the
   * eval/reviewer/sandbox gate. Server-side eligibility (previously-Production, same
   * definition, non-blank reason) is re-checked on every call regardless of what the
   * console shows (`_emergencyRollbackEligible` is a hint, not a security control). */
  async function emergencyRollback(versionId: string, reason: string) {
    const result = await fetchJson(`/api/v1/admin/agent-platform/definitions/${definitionId}/emergency-rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetVersionId: versionId, reason }),
    });
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Emergency rollback complete — Production traffic now points to this version.");
    await load();
  }

  async function submitForReview(versionId: string) {
    const result = await fetchJson<{ prNumber: number | null; reason?: "git-not-connected" }>(
      `/api/v1/admin/agent-platform/versions/${versionId}/submit-review`,
      { method: "POST" },
    );
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    if (result.data.prNumber === null) {
      // ADR-0009's 2026-08-23 amendment: nothing to open a PR/MR against (no Git
      // connection configured for this version). Not an error — just tell the user
      // what to expect instead of silently doing nothing visible.
      toast.info("No Git connection configured — this version will be approved in-app by another teammate instead of via a PR/MR.");
    }
    // UX_GUIDELINES.md §6.4 open question #1, resolved: the console orchestrates the
    // "runs automatically on submission" (FR-AGT-06) behavior by also triggering an
    // eval run here, immediately after opening the PR — the backend's endpoint
    // itself defaults to a Manual trigger, this is the frontend's job per the
    // guidance's own recommended division of responsibility.
    await fetchJson(`/api/v1/admin/agent-platform/versions/${versionId}/eval-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triggeredBy: "VersionSubmitted" }),
    });
    await load();
  }

  return (
    <div>
      <Breadcrumb name={name} />
      <h1 className="mb-6 font-heading text-lg font-semibold">{name ?? <Skeleton className="inline-block h-6 w-[200px]" />}</h1>

      {!gitConnected && gitConnected !== null && (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>
            Connect a Git repository to enable versioning, diff, and review for this agent.{" "}
            <NextLink href="/settings/integrations" className="ms-1 underline">
              Connect Git
            </NextLink>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.7,
          UX_GUIDELINES.md §6.8) — this screen's first `Tabs`. "Versions" is everything
          this screen was before this phase, unchanged and still the default;
          "Deployments & Canary" is the new surface. Explicit, literal `id`/`panelId`
          values (never Base UI's generated defaults) per `tabs.tsx`'s own required-id
          contract: both panels nest conditional data-loading branches whose tree shape
          differs between the server render and hydration. */}
      <Tabs defaultValue="versions">
        <TabsList aria-label="Agent definition sections" className="mb-4">
          <TabsTrigger id="definition-tab-versions" panelId="definition-panel-versions" value="versions">
            Versions
          </TabsTrigger>
          <TabsTrigger id="definition-tab-deployments" panelId="definition-panel-deployments" value="deployments">
            Deployments &amp; Canary
          </TabsTrigger>
        </TabsList>

        <TabsContent id="definition-panel-versions" value="versions">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-base font-semibold">Versions</h2>
            {canWrite && (
              <NextLink
                href={`/agent-platform/definitions/${definitionId}/versions/new`}
                className={cn(buttonVariants({ size: "sm" }))}
              >
                + New Version
              </NextLink>
            )}
          </div>

          {versions === null ? (
            <Skeleton className="h-[120px] w-full" role="status" aria-label="Loading versions" />
          ) : versions.length === 0 ? (
            <p className="text-muted-foreground">This agent definition has no versions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Eval</TableHead>
                  <TableHead>Git commit</TableHead>
                  <TableHead>PR</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v, idx) => (
                  <VersionRow
                    key={v.id}
                    definitionId={definitionId}
                    version={v}
                    previousVersionId={versions[idx + 1]?.id}
                    // Versions are ordered newest-first (`listAgentDefinitionVersions`'s
                    // `orderBy(desc(createdAt))`) — idx 0 is always the latest. "Restore"
                    // only makes sense on an older version (BL-07's own "author a new
                    // version" flow already covers the latest).
                    isLatest={idx === 0}
                    canWrite={canWrite}
                    onPromote={promote}
                    onSubmitForReview={submitForReview}
                    onEmergencyRollback={emergencyRollback}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent id="definition-panel-deployments" value="deployments">
          <DeploymentsPanel
            definitionId={definitionId}
            versions={(versions ?? []).map((v) => ({ id: v.id, version: v.version, status: v.status }))}
            canWrite={canWrite}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Breadcrumb({ name }: { name: string | null }) {
  return (
    <p className="mb-2 text-sm text-muted-foreground">
      <NextLink href="/agent-platform/definitions" className="hover:underline">
        Agent Platform &gt; Definitions
      </NextLink>
      {name ? ` > ${name}` : ""}
    </p>
  );
}

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "—";
}

/**
 * PR/MR column content. ADR-0009's 2026-08-23 amendment: a version with no
 * `gitPrNumber` no longer implies "PR review is required and unavailable" — when the
 * version also has no `gitCommitSha` (no Git connection was configured when it was
 * created), PR/MR review genuinely isn't applicable to it at all, and promotion to
 * `Approved` instead relies on the in-app reviewer!=author check
 * (`promotion-policy.ts`) as its documented approval mechanism. A version that *does*
 * have a commit but no PR yet (Git connected, review just not opened) keeps the
 * original, unchanged copy.
 */
function PrCell({ version }: { version: VersionListItem }) {
  if (version.gitPrNumber) {
    return (
      <span>
        #{version.gitPrNumber} <Badge variant="secondary">{version.gitPrStatus}</Badge>
      </span>
    );
  }
  if (!version.gitCommitSha) {
    return <span className="text-sm text-muted-foreground">No Git connection — approved in-app by another teammate</span>;
  }
  return <span className="text-sm text-muted-foreground">No PR yet</span>;
}

function VersionRow({
  definitionId,
  version,
  previousVersionId,
  isLatest,
  canWrite,
  onPromote,
  onSubmitForReview,
  onEmergencyRollback,
}: {
  definitionId: string;
  version: VersionListItem;
  previousVersionId?: string;
  isLatest: boolean;
  canWrite: boolean;
  onPromote: (versionId: string, target: AgentVersionStatus) => Promise<void>;
  onSubmitForReview: (versionId: string) => Promise<void>;
  onEmergencyRollback: (versionId: string, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [loadingReason, setLoadingReason] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<AgentVersionStatus | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackReason, setRollbackReason] = useState("");

  // The next pipeline step this version would take if it *could* be promoted —
  // used to fetch the "(?)" blocking reason (UX_GUIDELINES.md §6.4).
  const nextStep: AgentVersionStatus | null =
    version.status === "Draft"
      ? "EvalGated"
      : version.status === "EvalGated"
        ? "HumanReview"
        : version.status === "HumanReview"
          ? "Approved"
          : version.status === "Approved"
            ? "Production"
            : null;

  async function loadReason() {
    if (!nextStep || version._allowedTransitions.includes(nextStep)) return;
    setLoadingReason(true);
    const result = await fetchJson<{ allowed: boolean; reason?: string }>(
      `/api/v1/admin/agent-platform/versions/${version.id}/promotion-check?target=${nextStep}`,
    );
    setLoadingReason(false);
    if (result.kind === "ok" && result.data.reason) setReason(result.data.reason);
  }

  function handlePromoteClick(target: AgentVersionStatus) {
    if (target === "Production") {
      setConfirmTarget(target);
      setConfirmOpen(true);
      return;
    }
    void onPromote(version.id, target);
  }

  const statusBadge = STATUS_BADGE[version.status];

  return (
    <TableRow>
      <TableCell>{version.version}</TableCell>
      <TableCell>
        <Badge variant={statusBadge.variant} className={statusBadge.className}>
          {version.status}
        </Badge>
      </TableCell>
      <TableCell>
        <EvalBadge lastEvalRunId={version.lastEvalRunId} lastEvalRunStatus={version.lastEvalRunStatus} />
      </TableCell>
      <TableCell>{version.gitCommitSha ? <code className="text-xs">{shortSha(version.gitCommitSha)}</code> : "—"}</TableCell>
      <TableCell>
        <PrCell version={version} />
      </TableCell>
      <TableCell>{new Date(version.createdAt).toLocaleDateString()}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <NextLink href={`/agent-platform/versions/${version.id}`} className={cn(buttonVariants({ size: "xs", variant: "outline" }))}>
            Open
          </NextLink>
          {previousVersionId && (
            <NextLink
              href={`/agent-platform/diff?a=${previousVersionId}&b=${version.id}`}
              className={cn(buttonVariants({ size: "xs", variant: "outline" }))}
            >
              Compare…
            </NextLink>
          )}
          {canWrite && !isLatest && (
            <NextLink
              href={`/agent-platform/definitions/${definitionId}/versions/new?fromVersionId=${version.id}`}
              className={cn(buttonVariants({ size: "xs", variant: "outline" }))}
            >
              Restore
            </NextLink>
          )}
          {canWrite && version.gitCommitSha && !version.gitPrNumber && (
            <Button size="xs" onClick={() => void onSubmitForReview(version.id)}>
              Submit for Review
            </Button>
          )}
          {canWrite && version._allowedTransitions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="xs">Promote to…</Button>} />
              <DropdownMenuContent>
                {version._allowedTransitions.map((target) => (
                  <DropdownMenuItem key={target} onClick={() => handlePromoteClick(target)}>
                    {target}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* ADR-0017 — hidden (not merely disabled) for a version that could never
              pass the server-side eligibility check anyway (`_emergencyRollbackEligible`
              is a UI hint only; the server re-derives the same fact independently). */}
          {canWrite && version._emergencyRollbackEligible && (
            <Button size="xs" variant="destructive" onClick={() => setRollbackOpen(true)}>
              Emergency rollback…
            </Button>
          )}
          {nextStep && !version._allowedTransitions.includes(nextStep) && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Why can't I promote this further?"
                    aria-describedby={`promotion-reason-${version.id}`}
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => void loadReason()}
                  >
                    {loadingReason ? "…" : "?"}
                  </Button>
                }
              />
              <TooltipContent>{reason ?? "Click to see why this can't be promoted yet"}</TooltipContent>
            </Tooltip>
          )}
          <span className="sr-only" id={`promotion-reason-${version.id}`}>
            {reason}
          </span>
          {/* Phase 7 — the "(?)" tooltip above already surfaces `canPromote`'s exact
              blocking-reason string verbatim; when that reason is specifically the
              sandbox-test gate, also show a real, always-visible link to the Sandbox
              tab (not buried inside hover-only tooltip text) per this phase's own
              explicit "explain this requirement... with a link to the Sandbox tab"
              instruction. */}
          {nextStep === "Production" && reason?.includes("sandbox test") && (
            <NextLink href={`/agent-platform/versions/${version.id}?tab=sandbox`} className="text-sm underline">
              Run a sandbox test
            </NextLink>
          )}
        </div>
      </TableCell>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Promote to Production?</AlertDialogTitle>
            {/* Phase 17 (BL-48) corrected this copy: it used to promise traffic-split
                and rollback controls "in a later release", which stopped being true when
                the Deployments & Canary TAB shipped in this same phase. Deliberately
                called a tab, not a "Manager screen" — ADR-0019 §2.7 rejected that
                framing along with the separate console area it implied. */}
            <AlertDialogDescription>
              This immediately creates a 100% Production deployment for v{version.version}, replacing whatever was previously live. Adjust the split
              or promote a canary at any time from the Deployments &amp; Canary tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                if (confirmTarget) void onPromote(version.id, confirmTarget);
              }}
            >
              Confirm Promotion
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ADR-0017 §2.2 — a non-empty reason is a required input, not merely
          encouraged: the "Confirm" button stays disabled until one is typed, and the
          server re-validates the trimmed value regardless (a whitespace-only reason
          submitted by bypassing this control is still rejected server-side). */}
      <AlertDialog
        open={rollbackOpen}
        onOpenChange={(open) => {
          setRollbackOpen(open);
          if (!open) setRollbackReason("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Emergency rollback to v{version.version}?</AlertDialogTitle>
            <AlertDialogDescription>
              This immediately repoints 100% of Production traffic to v{version.version}, bypassing the eval/reviewer/sandbox gate — allowed only
              because this exact version already served Production traffic and passed the gate then (ADR-0017). It does not mark the version
              currently live as bad, and it does not create a new version. Every emergency rollback is written to the audit log with the reason
              below and is visible on this agent&apos;s deployment history, labelled distinctly from an ordinary rollback.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mb-2">
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor={`rollback-reason-${version.id}`} className="text-xs">
                Reason (required)
              </Label>
              <FieldHint
                id={`rollback-reason-${version.id}-hint`}
                content="A non-empty reason is required for every emergency rollback (FR-AGT-30) — it's written to the audit log alongside the actor, source, and target versions, and tenant administrators are notified."
              />
            </div>
            <Textarea
              id={`rollback-reason-${version.id}`}
              value={rollbackReason}
              onChange={(e) => setRollbackReason(e.target.value)}
              placeholder="e.g. v4 introduced a checkout regression — reverting to the last known-good version while we investigate."
              aria-required="true"
            />
          </div>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setRollbackOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rollbackReason.trim().length === 0}
              onClick={() => {
                setRollbackOpen(false);
                void onEmergencyRollback(version.id, rollbackReason);
                setRollbackReason("");
              }}
            >
              Confirm emergency rollback
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TableRow>
  );
}

/** U7 fix (QA 2026-08-15 UI pass, low — the badge used to always show a flat gray
 * "Ran" regardless of pass/fail). `lastEvalRunStatus` now comes from the same
 * `listVersions` call (no extra N+1 request) — "Passed" (green) / "Failed" (red, also
 * covers `Error`) / a neutral "Ran" for an in-flight run (`Queued`/`Running`, or the
 * status genuinely not supplied) / "Not run yet" (gray) when there's no run at all. */
function EvalBadge({ lastEvalRunId, lastEvalRunStatus }: { lastEvalRunId: string | null; lastEvalRunStatus?: "Queued" | "Running" | "Passed" | "Failed" | "Error" | null }) {
  if (!lastEvalRunId) {
    return <span className="text-sm text-muted-foreground">Not run yet</span>;
  }
  if (lastEvalRunStatus === "Passed") return <Badge className="bg-emerald-700 text-white">Passed</Badge>;
  if (lastEvalRunStatus === "Failed" || lastEvalRunStatus === "Error") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="secondary">Ran</Badge>;
}
