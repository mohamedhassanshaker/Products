"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AccessDeniedState, DelegationTree } from "@nextbot/ui";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Button } from "@nextbot/ui/components/ui/button";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Separator } from "@nextbot/ui/components/ui/separator";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import type { DelegationTreeResponse, PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";
import { WARNING_BADGE_CLASS } from "@nextbot/ui/lib/status-badge";
import { HarvestEvalCaseButton } from "@/src/components/HarvestEvalCaseButton";

interface AgentQueueOption {
  id: string;
  name: string;
}

interface TicketingToolOption {
  id: string;
  name: string;
  displayName: string;
}

interface AiAttempt {
  toolCallId: string;
  toolName: string;
  status: string;
  inputArgsMasked: Record<string, unknown> | null;
  outputMasked: unknown;
  errorMessage: string | null;
}

interface TakeoverDetail {
  id: string;
  conversationId: string;
  channelType: string | null;
  customerIdentifier: string | null;
  recognizedGoal: string | null;
  reason: string;
  reasonDetail: Record<string, unknown> | null;
  aiContextSnapshot: Record<string, unknown>;
  status: string;
  queueName: string | null;
  transcriptExcerpt: Array<{ sender: string; text: string; at: string }>;
  aiAttempts: AiAttempt[];
  // Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — CSAT.
  csatScore: number | null;
  csatComment: string | null;
  csatCapturedAt: string | null;
}

const CSAT_SCORE_OPTIONS = [1, 2, 3, 4, 5];

/** FR-AI-07's confidence badge convention, reused here for the context panel's
 * confidence-score display (green >0.85 / amber 0.60-0.85 / red <0.60). */
function confidenceBadge(confidence: unknown) {
  if (typeof confidence !== "number") return null;
  // QA fix (Batch D retry 1): amber-600/white failed WCAG AA (~3.19:1) — see
  // `WARNING_BADGE_CLASS`'s doc comment for the verified replacement/rationale.
  const className = confidence > 0.85 ? "bg-emerald-700 text-white" : confidence >= 0.6 ? WARNING_BADGE_CLASS : "bg-destructive text-white";
  return <Badge className={className}>{(confidence * 100).toFixed(0)}%</Badge>;
}

/**
 * B.5.2 Live Agent Takeover Panel — conversation pane (live thread + AI-drafted
 * suggestion, FR-AI-08), context panel (AI summary/goal/params/tool calls made/
 * confidence/customer info), tool panel (manual permissioned MCP tool trigger,
 * FR-ESC-02), and an actions bar (Resolve & Close / Return to Bot).
 *
 * **Live updates**: this panel polls `reload()` every 5s while mounted (see the
 * dedicated effect below) rather than a real SSE subscription — the dedicated SSE
 * surface for the takeover panel (LLD §5.8's `.../stream`) is a disclosed,
 * deliberate simplification cut from an earlier dispatch's time budget (not
 * introduced or changed by this shadcn/Tailwind conversion — the polling
 * interval/cleanup logic is carried over unchanged so a human-agent message sent
 * from a separate session still surfaces here within one poll interval).
 *
 * **Trace-data disclosure**: the confidence score / tool-call attempts shown here
 * come from `escalation.ai_context_snapshot`, populated at the moment of escalation
 * (real, always present) — not from `agent_run`/`agent_run_span` (which QA's Phase
 * 12-13 pass already flagged as inert for real traffic pending BL-13's deployed-
 * version resolution). This panel intentionally reads only what's genuinely
 * populated today rather than building against trace data that won't arrive.
 */
export function TakeoverPanel({ escalationId, permissionLevel }: { escalationId: string; permissionLevel: PermissionLevelValue }) {
  const router = useRouter();
  const [detail, setDetail] = useState<TakeoverDetail | null>(null);
  // FR-ORC-06 — the whole delegation tree for the run that escalated, not just the
  // terminal agent. Fetched from the SAME endpoint Runtime Traces uses, so the two
  // surfaces can never render a different tree for the same run.
  const [delegationTree, setDelegationTree] = useState<DelegationTreeResponse | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [draft, setDraft] = useState<{ draftText: string; confidence: number } | null>(null);
  const [toolId, setToolId] = useState("");
  const [toolArgs, setToolArgs] = useState("{}");
  const [busy, setBusy] = useState<string | null>(null);
  // QA fix (D2): the panel previously implemented only 2 of B.5.2's 4 required
  // actions. These back "Transfer to [queue]" and "Create Case".
  const [queues, setQueues] = useState<AgentQueueOption[]>([]);
  const [transferQueueId, setTransferQueueId] = useState("");
  const [ticketingTools, setTicketingTools] = useState<TicketingToolOption[]>([]);
  const [createCaseToolId, setCreateCaseToolId] = useState("");
  // Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — CSAT capture at the
  // close of a takeover. Both optional: neither Resolve nor Return to Bot is ever
  // blocked on these being filled in (see `resolveAndClose`/`returnToBot` below).
  const [csatScore, setCsatScore] = useState<string>("");
  const [csatComment, setCsatComment] = useState("");
  const canAct = permissionLevel === "Write";
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function reload() {
    const result = await fetchJson<TakeoverDetail>(`/api/v1/admin/escalations/${escalationId}`);
    if (result.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (result.kind === "ok") setDetail(result.data);
  }

  useEffect(() => {
    // "Transfer to [queue]" reuses the same queue list Escalation Routing/reassignment
    // already exposes (B.5.1's own reassign action) rather than a second queue-fetch
    // implementation.
    void (async () => {
      const result = await fetchJson<{ queues: Array<{ id: string; name: string }> }>("/api/v1/admin/escalation-queues");
      if (result.kind === "ok" && Array.isArray(result.data.queues)) {
        setQueues(result.data.queues);
        setTransferQueueId((current) => current || (result.data.queues[0]?.id ?? ""));
      }
    })();
    // "Create Case" is conceptually a manual tool trigger (BE1's now-tier-aware
    // `.../tool-calls` route) against a ticketing-type tool, pre-filled with context.
    void (async () => {
      const result = await fetchJson<{ tools: TicketingToolOption[] }>(`/api/v1/admin/escalations/${escalationId}/ticketing-tools`);
      if (result.kind === "ok" && Array.isArray(result.data.tools)) {
        setTicketingTools(result.data.tools);
        setCreateCaseToolId((current) => current || (result.data.tools[0]?.id ?? ""));
      }
    })();
  }, [escalationId]);

  useEffect(() => {
    void reload();
    // Simple polling refresh of the transcript while the panel is open — see this
    // component's top doc comment for why this isn't a real SSE subscription yet.
    pollRef.current = setInterval(() => void reload(), 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [escalationId]);

  // FR-ORC-06 — load the escalating run's delegation tree once the detail (and hence
  // `delegationRunId`) is known. Deliberately NOT inside the 5s poll: the tree of a
  // run that has already escalated is immutable, so re-fetching it every tick would
  // be pure load for no new information.
  useEffect(() => {
    const runId = detail?.aiContextSnapshot?.delegationRunId;
    if (typeof runId !== "string") return;
    if (delegationTree !== null) return;
    void fetchJson<DelegationTreeResponse>(`/api/v1/admin/agent-runs/${runId}/delegation-tree`).then((r) => {
      if (r.kind === "ok") setDelegationTree(r.data);
    });
  }, [detail, delegationTree]);

  async function sendMessage() {
    if (!messageText.trim()) return;
    setBusy("send");
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/escalations/${escalationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: { contentType: "Text", text: messageText } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.title ?? "Could not send the message.");
        return;
      }
      setMessageText("");
      setDraft(null);
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function requestDraft() {
    setBusy("draft");
    setError(null);
    try {
      const result = await fetchJson<{ draftText: string; confidence: number }>(`/api/v1/admin/escalations/${escalationId}/draft`, {
        method: "POST",
      });
      if (result.kind === "ok") setDraft(result.data);
      else if (result.kind === "error") setError(result.message);
    } finally {
      setBusy(null);
    }
  }

  async function invokeTool() {
    setBusy("tool");
    setError(null);
    try {
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(toolArgs || "{}");
      } catch {
        setError("Tool args must be valid JSON.");
        return;
      }
      const res = await fetch(`/api/v1/admin/escalations/${escalationId}/tool-calls`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolId, args: parsedArgs }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.title ?? "Tool invocation failed.");
        return;
      }
    } finally {
      setBusy(null);
    }
  }

  /** Builds the optional CSAT body — `undefined` fields are simply omitted (never
   * blocks the close either way, per FR-ESC-05's own "don't block the transition"
   * requirement). */
  function buildCsatBody(): { csatScore?: number; csatComment?: string } {
    const body: { csatScore?: number; csatComment?: string } = {};
    if (csatScore) body.csatScore = Number(csatScore);
    if (csatComment.trim()) body.csatComment = csatComment.trim();
    return body;
  }

  async function resolveAndClose() {
    setBusy("resolve");
    try {
      await fetch(`/api/v1/admin/escalations/${escalationId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildCsatBody()),
      });
      router.push("/escalations");
    } finally {
      setBusy(null);
    }
  }

  async function returnToBot() {
    setBusy("return");
    try {
      await fetch(`/api/v1/admin/escalations/${escalationId}/return-to-bot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildCsatBody()),
      });
      router.push("/escalations");
    } finally {
      setBusy(null);
    }
  }

  /** B.5.2's "Transfer to [queue]" action — moves this escalation to a different
   * queue via the same `reassign` route B.5.1's own reassignment already uses;
   * the escalation stays `InProgress` (a same-panel transfer, not a claim release),
   * matching `reassignEscalation`'s documented `InProgress -> InProgress` self-loop. */
  async function transferToQueue() {
    if (!transferQueueId) return;
    setBusy("transfer");
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/escalations/${escalationId}/reassign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queueId: transferQueueId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.title ?? "Could not transfer this escalation.");
        return;
      }
      router.push("/escalations");
    } finally {
      setBusy(null);
    }
  }

  /** B.5.2's "Create Case" action — conceptually a manual tool trigger (BE1's
   * now-tier-aware `.../tool-calls` route) against a ticketing-type tool, pre-filled
   * with this escalation's context so the agent only has to review/adjust before
   * submitting. A Tier-2/3-configured ticketing tool now correctly suspends for
   * confirmation/approval instead of firing immediately (BE1). */
  async function createCase() {
    if (!createCaseToolId || !detail) return;
    setBusy("create-case");
    setError(null);
    try {
      const prefilledArgs = {
        conversationId: detail.conversationId,
        reason: detail.reason,
        recognizedGoal: detail.recognizedGoal,
        customer: detail.customerIdentifier,
      };
      const res = await fetch(`/api/v1/admin/escalations/${escalationId}/tool-calls`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolId: createCaseToolId, args: prefilledArgs }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.title ?? "Could not create a case.");
        return;
      }
    } finally {
      setBusy(null);
    }
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Escalation Takeover" />;
  if (!detail) return <Skeleton className="h-32 w-full" role="status" aria-label="Loading escalation" />;

  const confidence = (detail.aiContextSnapshot as { confidence?: unknown }).confidence;
  // Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-06) — "the escalation
  // record carries the full delegation chain, and the human takeover panel renders
  // the whole delegation tree, not just the terminal agent." Written into
  // `ai_context_snapshot` by the composition root's escalation sink
  // (`attachDelegationContextToEscalation`) at the moment the delegation run
  // escalated. Absent for every non-team escalation, in which case this whole
  // section is simply not rendered — no change to the existing panel.
  const delegationRunId = (detail.aiContextSnapshot as { delegationRunId?: unknown }).delegationRunId;
  // Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — populated by
  // `triggerEscalation()` (always an array, never absent — see that function's own
  // doc comment for why an empty array covers both "linking disabled" and "no match
  // found"). Rendered only when non-empty, so this section adds nothing visible for
  // the overwhelming majority of escalations where a tenant hasn't opted in.
  const linkedConversations = ((detail.aiContextSnapshot as { linkedConversations?: unknown }).linkedConversations ?? []) as Array<{
    conversationId: string;
    channelType: string | null;
    status: string;
    lastActivityAt: string;
  }>;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Live Takeover</h1>
        {/* QA fix (D6): Chakra's default `colorScheme="green"` badge (white-on-#38a169,
            ~3.24:1) fails WCAG AA — forced to an explicit, pre-verified-contrast
            pairing instead, same convention as `AdminShell.tsx`'s Avatar/`BrandingSettings.tsx`'s
            text-color fixes (bump the shade until it clears 4.5:1, don't rely on the
            theme default). `emerald-700` (`#047857`) on white text clears 4.5:1. */}
        <Badge className={detail.status === "InProgress" ? "bg-emerald-700 text-white" : "bg-muted-foreground text-white"}>{detail.status}</Badge>
      </div>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr_1fr]">
        {/* Conversation panel */}
        <div className="rounded-none border p-4">
          <h2 className="mb-2 font-heading text-sm font-semibold">Conversation</h2>
          <div className="mb-3 flex max-h-[360px] flex-col gap-1 overflow-y-auto">
            {detail.transcriptExcerpt.map((m, i) => (
              <p key={i} className="text-xs">
                <b>{m.sender}:</b> {m.text}
              </p>
            ))}
          </div>
          <Separator className="mb-2" />
          {canAct ? (
            <>
              {draft && (
                <div className="mb-2 rounded-none bg-purple-50 p-2">
                  <p className="mb-1 text-xs font-bold">
                    AI-drafted suggestion ({(draft.confidence * 100).toFixed(0)}% confidence) — edit or discard, never auto-sent
                  </p>
                  <p className="text-xs">{draft.draftText}</p>
                  <div className="mt-1 flex gap-2">
                    <Button size="xs" onClick={() => setMessageText(draft.draftText)}>
                      Use as draft
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setDraft(null)}>
                      Discard
                    </Button>
                  </div>
                </div>
              )}
              <Textarea
                aria-label="Message to customer"
                placeholder="Type your reply…"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                className="mb-2"
                disabled={detail.status !== "InProgress"}
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={busy === "send" || detail.status !== "InProgress"} onClick={sendMessage}>
                  {busy === "send" ? "Sending…" : "Send"}
                </Button>
                <Button size="sm" variant="outline" disabled={busy === "draft" || detail.status !== "InProgress"} onClick={requestDraft}>
                  {busy === "draft" ? "Suggesting…" : "Suggest a reply"}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">You have read-only access to this escalation.</p>
          )}
        </div>

        {/* Context panel */}
        <div className="rounded-none border p-4">
          <h2 className="mb-2 font-heading text-sm font-semibold">Context</h2>
          <p className="text-xs text-muted-foreground">Reason: {detail.reason}</p>
          <p className="text-xs text-muted-foreground">Recognized goal: {detail.recognizedGoal ?? "—"}</p>
          <p className="text-xs text-muted-foreground">Customer: {detail.customerIdentifier ?? "—"}</p>
          <p className="text-xs text-muted-foreground">Channel: {detail.channelType ?? "—"}</p>
          <p className="text-xs text-muted-foreground">Queue: {detail.queueName ?? "—"}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Confidence:</span>
            {confidenceBadge(confidence) ?? <span className="text-xs">—</span>}
          </div>
          {typeof delegationRunId === "string" && (
            <>
              <Separator className="my-2" />
              <p className="mb-1 text-xs font-bold">Delegation tree</p>
              {delegationTree === null ? (
                <p className="text-muted-foreground text-xs">Loading the delegation tree…</p>
              ) : (
                <DelegationTree roots={delegationTree.roots} emptyMessage="No delegation events recorded for this run." />
              )}
            </>
          )}
          {linkedConversations.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="mb-1 text-xs font-bold">Linked conversations (other channels)</p>
              <div className="flex flex-col gap-1">
                {linkedConversations.map((lc) => (
                  <p key={lc.conversationId} className="text-xs text-muted-foreground">
                    {lc.channelType ?? "Unknown channel"} — {lc.status} — last active{" "}
                    {new Date(lc.lastActivityAt).toLocaleString()}
                  </p>
                ))}
              </div>
            </>
          )}
          <Separator className="my-2" />
          <p className="mb-1 text-xs font-bold">Tool calls the AI already tried</p>
          {detail.aiAttempts.length === 0 ? (
            <p className="text-xs text-muted-foreground">None recorded for this escalation.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {detail.aiAttempts.map((a) => (
                <div key={a.toolCallId} className="rounded-none border p-1 text-xs">
                  <p className="font-bold">
                    {a.toolName} — {a.status}
                  </p>
                  {a.errorMessage && <p className="text-destructive">{a.errorMessage}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tool panel */}
        <div className="rounded-none border p-4">
          <h2 className="mb-2 font-heading text-sm font-semibold">Manual Tool Trigger</h2>
          {canAct ? (
            <>
              <p className="mb-1 text-xs">Tool ID</p>
              <Textarea aria-label="Tool ID" rows={1} value={toolId} onChange={(e) => setToolId(e.target.value)} className="mb-2" />
              <p className="mb-1 text-xs">Args (JSON)</p>
              <Textarea aria-label="Tool args (JSON)" value={toolArgs} onChange={(e) => setToolArgs(e.target.value)} className="mb-2" />
              <Button size="sm" disabled={!toolId || detail.status !== "InProgress"} onClick={invokeTool}>
                {busy === "tool" ? "Invoking…" : "Invoke"}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Read-only.</p>
          )}

          <Separator className="my-3" />
          <h2 className="mb-2 font-heading text-sm font-semibold">Actions</h2>
          {canAct && (
            <div className="flex flex-col gap-2">
              {/* Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — optional
                  CSAT capture before closing out. Never required: both buttons below
                  stay enabled with no score chosen (see `buildCsatBody`). */}
              {detail.status === "InProgress" && (
                <div className="mb-1 border-b pb-2">
                  <p className="mb-1 text-xs">Customer satisfaction (optional)</p>
                  <Select value={csatScore || undefined} onValueChange={(v) => setCsatScore((v as string) ?? "")}>
                    <SelectTrigger aria-label="CSAT score" className="mb-1 w-full">
                      <SelectValue placeholder="No score" />
                    </SelectTrigger>
                    <SelectContent>
                      {CSAT_SCORE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} / 5
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea
                    aria-label="CSAT comment"
                    placeholder="Optional comment…"
                    rows={2}
                    value={csatComment}
                    onChange={(e) => setCsatComment(e.target.value)}
                  />
                </div>
              )}
              {/* QA fix (D6): explicit pre-verified-contrast pairing (emerald-700/white,
                  ≥4.5:1) instead of Chakra's default `colorScheme="green"`
                  (white-on-#38a169, ~3.24:1, below WCAG AA) — same convention as
                  the status Badge above. */}
              <Button
                size="sm"
                className="bg-emerald-700 text-white hover:bg-emerald-800"
                disabled={busy === "resolve" || detail.status !== "InProgress"}
                onClick={resolveAndClose}
              >
                {busy === "resolve" ? "Resolving…" : "Resolve & Close"}
              </Button>
              <Button size="sm" className="bg-purple-700 text-white hover:bg-purple-800" disabled={busy === "return" || detail.status !== "InProgress"} onClick={returnToBot}>
                {busy === "return" ? "Returning…" : "Return to Bot"}
              </Button>
              {/* Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-16) built this
                  button generic/reusable across all three detail views; only the
                  conversation call site was wired then. Phase 13 wires the escalation
                  call site (small addition — source/sourceRef/transcript only differ),
                  appending the CSAT result as extra context when present. */}
              <HarvestEvalCaseButton
                source="HarvestedEscalation"
                sourceRef={detail.id}
                defaultName={`Escalation ${detail.id.slice(0, 8)}`}
                transcript={[
                  ...detail.transcriptExcerpt.map((m) => ({ sender: m.sender, text: m.text })),
                  ...(detail.csatScore != null
                    ? [{ sender: "System", text: `CSAT: ${detail.csatScore}/5${detail.csatComment ? ` — ${detail.csatComment}` : ""}` }]
                    : []),
                ]}
              />

              {/* QA fix (D2): "Transfer to [queue]" — previously missing entirely. */}
              <div className="mt-1 border-t pt-2">
                <p className="mb-1 text-xs">Transfer to queue</p>
                <div className="flex gap-2">
                  <Select
                    value={transferQueueId || undefined}
                    onValueChange={(v) => setTransferQueueId(v as string)}
                    disabled={detail.status !== "InProgress" || queues.length === 0}
                  >
                    <SelectTrigger aria-label="Transfer to queue" className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {queues.map((q) => (
                        <SelectItem key={q.id} value={q.id}>
                          {q.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={busy === "transfer" || detail.status !== "InProgress" || !transferQueueId} onClick={transferToQueue}>
                    {busy === "transfer" ? "Transferring…" : "Transfer"}
                  </Button>
                </div>
              </div>

              {/* QA fix (D2): "Create Case" — previously missing entirely. */}
              <div className="mt-1 border-t pt-2">
                <p className="mb-1 text-xs">Create case</p>
                {ticketingTools.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No ticketing tool is available for this tenant.</p>
                ) : (
                  <div className="flex gap-2">
                    <Select
                      value={createCaseToolId || undefined}
                      onValueChange={(v) => setCreateCaseToolId(v as string)}
                      disabled={detail.status !== "InProgress"}
                    >
                      <SelectTrigger aria-label="Create case tool" className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ticketingTools.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" disabled={busy === "create-case" || detail.status !== "InProgress" || !createCaseToolId} onClick={createCase}>
                      {busy === "create-case" ? "Creating…" : "Create Case"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
