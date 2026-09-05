"use client";

import { Fragment, useEffect, useState } from "react";
import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nextbot/ui/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";
import { ChatPreviewPanel } from "@/src/components/ChatPreviewPanel";

interface VersionData {
  id: string;
  agentDefinitionId: string;
  version: string;
  status: string;
  graphType: string;
  definitionYaml: string;
  evalSuiteId: string | null;
  gitCommitSha: string | null;
}

interface EvalSuiteItem {
  id: string;
  name: string;
}

interface EvalRunItem {
  id: string;
  status: "Queued" | "Running" | "Passed" | "Failed" | "Error";
  passRatePct: string | null;
  triggeredBy: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** U2 fix (QA 2026-08-15 UI pass, high) — the per-case pass/fail breakdown behind
 * `GET /eval-runs/:id/results`, which existed and worked on the backend but was never
 * called from any frontend component. */
/** Phase 6 (client-feedback-batch item 9) — the minimal shape `ChatPreviewPanel`
 * needs to mount, sourced from the same `GET /api/v1/admin/channels` list endpoint
 * `ChannelsList.tsx` already uses. */
interface SandboxChannelInfo {
  channelPublicKey: string;
  tenantSlug: string;
  widgetBaseUrl: string;
}

interface EvalCaseResultItem {
  id: string;
  evalCaseId: string;
  caseName: string;
  passed: boolean;
  actualResponse: string | null;
  failureReason: string | null;
  costUsd: string | null;
  latencyMs: number | null;
}

const RUN_STATUS_BADGE: Record<string, { variant?: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  Queued: { variant: "secondary" },
  Running: { className: "bg-blue-700 text-white" },
  Passed: { className: "bg-emerald-700 text-white" },
  Failed: { variant: "destructive" },
  Error: { variant: "destructive" },
};

/** The same neutral "not yet supported" treatment `EvalSuiteDetail.tsx` already uses
 * for a tool-call case's expectation column (FR-AGT-06's Phase-12 scope trim) — a
 * tool-call case's result is never genuinely "Failed" from the tenant's perspective,
 * it's a known, honestly-labeled gap, not a red error. */
function caseResultStatus(r: EvalCaseResultItem): { label: string; className?: string; neutral?: boolean } {
  if (r.failureReason?.includes("Phase 12")) return { label: "Not yet supported", neutral: true };
  return r.passed ? { label: "Passed", className: "bg-emerald-700 text-white" } : { label: "Failed" };
}

/** BL-07 Version Editor / Detail read view (UX_GUIDELINES.md §6.4/§6.5). Versions are
 * immutable once created (no in-place edit) — this screen is read-only for the YAML
 * content; authoring the *next* version is a separate screen
 * (`/agent-platform/definitions/[id]/versions/new`). */
export function VersionDetail({ versionId, canWrite }: { versionId: string; canWrite: boolean }) {
  // Phase 7 (client-feedback-batch item 6) — `DefinitionDetail.tsx`'s "Run a sandbox
  // test" link (shown next to the Production-promotion gate's blocking reason) deep
  // links here with `?tab=sandbox` so the user lands directly on the Sandbox tab
  // instead of Overview, same `?tab=` convention `mcp-health/page.tsx` already
  // established.
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "sandbox" ? "sandbox" : "overview";
  const [version, setVersion] = useState<VersionData | null>(null);
  const [suites, setSuites] = useState<EvalSuiteItem[] | null>(null);
  const [runs, setRuns] = useState<EvalRunItem[] | null>(null);
  const [selectedSuiteId, setSelectedSuiteId] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // U2 fix: per-run case-results, fetched on demand (not one call per run up front)
  // and cached by run id so re-expanding doesn't refetch.
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [caseResultsByRun, setCaseResultsByRun] = useState<Record<string, EvalCaseResultItem[]>>({});
  const [loadingResults, setLoadingResults] = useState(false);
  // Phase 6 — Sandbox tab state. `undefined` = still loading, `null` = loaded but no
  // WebWidget channel exists yet for this tenant (a real, honestly-labeled gap, not
  // an error), forbidden tracked separately since it needs different copy.
  const [sandboxChannel, setSandboxChannel] = useState<SandboxChannelInfo | null | undefined>(undefined);
  const [sandboxForbidden, setSandboxForbidden] = useState(false);

  async function load() {
    const result = await fetchJson<{ version: VersionData }>(`/api/v1/admin/agent-platform/versions/${versionId}`);
    if (result.kind === "ok") {
      setVersion(result.data.version);
      setSelectedSuiteId(result.data.version.evalSuiteId ?? "");
    } else if (result.kind === "error") {
      setError(result.message);
    }
    const runsResult = await fetchJson<{ runs: EvalRunItem[] }>(`/api/v1/admin/agent-platform/versions/${versionId}/eval-runs`);
    if (runsResult.kind === "ok") setRuns(runsResult.data.runs);
  }

  useEffect(() => {
    void load();
  }, [versionId]);

  // Phase 6: the Sandbox tab needs *some* WebWidget channel to bootstrap a preview
  // session against (agent versions aren't themselves tied to a channel) — this picks
  // the tenant's first WebWidget channel, any environment, purely as a vehicle for
  // capability/branding config; the override forces the session's own environment to
  // "Sandbox" regardless of which channel row it borrows (see
  // `create-widget-session.ts`'s doc). A tenant with no WebWidget channel yet gets an
  // honest "add one first" message instead of a broken preview.
  useEffect(() => {
    void (async () => {
      const result = await fetchJson<{ channels: Array<{ type: string; publicKey: string }>; tenantSlug: string; widgetBaseUrl: string }>(
        "/api/v1/admin/channels",
      );
      if (result.kind === "forbidden") {
        setSandboxForbidden(true);
        return;
      }
      if (result.kind !== "ok") return;
      const webWidget = (result.data.channels ?? []).find((c) => c.type === "WebWidget");
      setSandboxChannel(
        webWidget ? { channelPublicKey: webWidget.publicKey, tenantSlug: result.data.tenantSlug, widgetBaseUrl: result.data.widgetBaseUrl } : null,
      );
    })();
  }, []);

  useEffect(() => {
    fetchJson<{ suites: EvalSuiteItem[] }>("/api/v1/admin/agent-platform/eval-suites").then((r) => {
      if (r.kind === "ok") setSuites(r.data.suites);
    });
  }, []);

  async function bindSuite() {
    if (!selectedSuiteId) return;
    const result = await fetchJson(`/api/v1/admin/agent-platform/versions/${versionId}/bind-eval-suite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ evalSuiteId: selectedSuiteId }),
    });
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    await load();
  }

  async function runSuite() {
    setRunning(true);
    const result = await fetchJson(`/api/v1/admin/agent-platform/versions/${versionId}/eval-runs`, { method: "POST" });
    setRunning(false);
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    await load();
  }

  /** U2 fix — toggles the per-case results table for one run, fetching it on first
   * expand (`GET /eval-runs/:id/results`, previously wired up on the backend but never
   * called from anywhere in the frontend). */
  async function toggleResults(runId: string) {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    if (caseResultsByRun[runId]) return;
    setLoadingResults(true);
    const result = await fetchJson<{ results: EvalCaseResultItem[] }>(`/api/v1/admin/agent-platform/eval-runs/${runId}/results`);
    setLoadingResults(false);
    if (result.kind === "ok") setCaseResultsByRun((prev) => ({ ...prev, [runId]: result.data.results }));
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!version) return <Skeleton className="h-[300px] w-full" role="status" aria-label="Loading version" />;

  return (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">
        <NextLink href={`/agent-platform/definitions/${version.agentDefinitionId}`} className="hover:underline">
          Agent Platform &gt; Definitions
        </NextLink>
        {` > v${version.version}`}
      </p>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">
          v{version.version} <Badge variant="secondary" className="ms-2">{version.status}</Badge>
        </h1>
      </div>

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger id="version-detail-tab-overview" panelId="version-detail-panel-overview" value="overview">Overview</TabsTrigger>
          <TabsTrigger id="version-detail-tab-eval" panelId="version-detail-panel-eval" value="eval">Eval</TabsTrigger>
          <TabsTrigger id="version-detail-tab-sandbox" panelId="version-detail-panel-sandbox" value="sandbox">Sandbox</TabsTrigger>
        </TabsList>
        <TabsContent id="version-detail-panel-overview" value="overview" className="px-0">
          <p className="mb-2 font-medium">Graph type: {version.graphType}</p>
          <p className="mb-2 font-medium">Definition (read-only — versions are immutable; author a new version to change content)</p>
          <Textarea
            value={version.definitionYaml}
            readOnly
            className="min-h-[400px] font-mono text-sm"
            aria-label="Agent definition YAML content"
          />
        </TabsContent>
        <TabsContent id="version-detail-panel-eval" value="eval" className="px-0">
          {!version.evalSuiteId ? (
            <div>
              <p className="mb-2">No eval suite is bound to this version yet — bind one to enable promotion past Draft.</p>
              <div className="mb-1 flex items-center gap-1">
                <Label htmlFor="version-detail-eval-suite-select" className="text-sm">
                  Eval suite
                </Label>
                <FieldHint
                  id="version-detail-eval-suite-select-hint"
                  content="Which reusable eval suite gates this version's promotion — once bound, Run Eval Suite below executes every case in it against this exact version and the pass rate is what promotion past Draft checks."
                />
              </div>
              <div className="flex items-center gap-2">
                <Select value={selectedSuiteId} onValueChange={(v) => v !== null && setSelectedSuiteId(v)}>
                  <SelectTrigger id="version-detail-eval-suite-select" className="w-[300px]" aria-label="Select eval suite">
                    <SelectValue placeholder="Select eval suite" />
                  </SelectTrigger>
                  <SelectContent>
                    {suites?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canWrite && (
                  <Button onClick={() => void bindSuite()} disabled={!selectedSuiteId}>
                    Bind Eval Suite
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <p>
                  Bound suite:{" "}
                  <NextLink href={`/agent-platform/evals/${version.evalSuiteId}`} className="underline">
                    {suites?.find((s) => s.id === version.evalSuiteId)?.name ?? version.evalSuiteId}
                  </NextLink>
                </p>
                {canWrite && (
                  <Button onClick={() => void runSuite()} disabled={running}>
                    {running ? "Running…" : "Run Eval Suite"}
                  </Button>
                )}
              </div>
              {runs === null ? (
                <Skeleton className="h-[100px] w-full" role="status" aria-label="Loading eval runs" />
              ) : runs.length === 0 ? (
                <p className="text-muted-foreground">No eval runs yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Pass rate</TableHead>
                      <TableHead>Triggered by</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Results</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => {
                      const runBadge = RUN_STATUS_BADGE[r.status];
                      return (
                        <Fragment key={r.id}>
                          <TableRow>
                            <TableCell>
                              <Badge variant={runBadge?.variant} className={runBadge?.className}>
                                {r.status}
                              </Badge>
                            </TableCell>
                            <TableCell>{r.passRatePct !== null ? `${Number(r.passRatePct).toFixed(0)}%` : "—"}</TableCell>
                            <TableCell>{r.triggeredBy}</TableCell>
                            <TableCell>{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</TableCell>
                            <TableCell>
                              <Button size="xs" variant="outline" onClick={() => void toggleResults(r.id)} disabled={loadingResults && expandedRunId === r.id}>
                                {expandedRunId === r.id ? "Hide results" : "View results"}
                              </Button>
                            </TableCell>
                          </TableRow>
                          {expandedRunId === r.id && (
                            <TableRow>
                              <TableCell colSpan={5} className="bg-muted/50">
                                {!caseResultsByRun[r.id] ? (
                                  <Skeleton className="h-[60px] w-full" role="status" aria-label="Loading case results" />
                                ) : caseResultsByRun[r.id]!.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">No case results for this run.</p>
                                ) : (
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Case</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Actual response</TableHead>
                                        <TableHead>Failure reason</TableHead>
                                        <TableHead>Cost</TableHead>
                                        <TableHead>Latency</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {caseResultsByRun[r.id]!.map((c) => {
                                        const status = caseResultStatus(c);
                                        return (
                                          <TableRow key={c.id}>
                                            <TableCell>{c.caseName}</TableCell>
                                            <TableCell>
                                              {status.neutral ? (
                                                <span className="text-sm text-muted-foreground">{status.label}</span>
                                              ) : (
                                                <Badge variant={status.className ? undefined : "destructive"} className={status.className}>
                                                  {status.label}
                                                </Badge>
                                              )}
                                            </TableCell>
                                            <TableCell>
                                              <span className="block max-w-[240px] truncate text-sm">{c.actualResponse || "—"}</span>
                                            </TableCell>
                                            <TableCell>
                                              <span className="block max-w-[240px] truncate text-sm">{c.failureReason ?? "—"}</span>
                                            </TableCell>
                                            <TableCell>{c.costUsd ? `$${Number(c.costUsd).toFixed(4)}` : "—"}</TableCell>
                                            <TableCell>{c.latencyMs !== null ? `${c.latencyMs}ms` : "—"}</TableCell>
                                          </TableRow>
                                        );
                                      })}
                                    </TableBody>
                                  </Table>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </TabsContent>
        <TabsContent id="version-detail-panel-sandbox" value="sandbox" className="px-0">
          <p className="mb-4 text-sm text-muted-foreground">
            Test this exact version&apos;s conversation flow before promoting it — this conversation is isolated from real customer traffic and never
            visible to your live channels.
          </p>
          {sandboxForbidden ? (
            <p className="text-sm text-muted-foreground">You need access to Channels to use the sandbox preview.</p>
          ) : sandboxChannel === undefined ? (
            <Skeleton className="h-[600px] w-full max-w-[420px]" role="status" aria-label="Loading sandbox preview" />
          ) : sandboxChannel === null ? (
            <p className="text-sm text-muted-foreground">
              No Web Widget channel exists yet for this tenant —{" "}
              <NextLink href="/channels/new" className="underline">
                add one under Channels
              </NextLink>{" "}
              to enable the sandbox preview.
            </p>
          ) : (
            <ChatPreviewPanel
              tenantSlug={sandboxChannel.tenantSlug}
              channelPublicKey={sandboxChannel.channelPublicKey}
              widgetBaseUrl={sandboxChannel.widgetBaseUrl}
              previewVersionId={versionId}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
