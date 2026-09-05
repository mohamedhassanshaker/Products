"use client";

import { useEffect, useRef, useState } from "react";
import NextLink from "next/link";
import { AccessDeniedState } from "@nextbot/ui";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Separator } from "@nextbot/ui/components/ui/separator";
import { Progress } from "@nextbot/ui/components/ui/progress";
import { Tooltip, TooltipTrigger, TooltipContent } from "@nextbot/ui/components/ui/tooltip";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@nextbot/ui/components/ui/collapsible";
import { cn } from "@nextbot/ui/lib/utils";
import { WARNING_BADGE_CLASS } from "@nextbot/ui/lib/status-badge";
import type { ConversationStatusValue, PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";
import { HarvestEvalCaseButton } from "@/src/components/HarvestEvalCaseButton";

/** Target Architecture Blueprint Phase 10 (BL-41, FR-KB-07, LLD §14.4.4) — mirrors
 *  `@nextbot/contracts`'s `CitationSchema` for this client component's own typing
 *  (no cross-app import of the TypeBox schema itself). */
interface CitationDto {
  collectionId: string;
  collectionName: string;
  documentId: string;
  documentTitle: string;
  chunkId: string;
  page?: number;
  section?: string;
  snippet: string;
  relationPath?: Array<{ srcName: string; relation: string; dstName: string; provenanceChunkId: string }>;
}

interface ConversationMessage {
  id: string;
  sequence: number;
  sender: string;
  contentType: string;
  payload: Record<string, unknown> & { citations?: CitationDto[] };
  confidenceScore: number | null;
  agentRunId: string | null;
  createdAt: string;
}

interface ConversationDetailData {
  id: string;
  channelId: string;
  status: ConversationStatusValue;
  recognizedGoal: string | null;
  resolutionType: string | null;
  language: string;
  startedAt: string;
  endedAt: string | null;
  lastActivityAt: string;
  totalCostUsd: string;
  totalTokensIn: number;
  totalTokensOut: number;
  externalThreadId: string | null;
  customerIdentifier: string | null;
  metadata: Record<string, unknown> | null;
  messages: ConversationMessage[];
}

interface AgentRunSpanDto {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  attributes: Record<string, string>;
  status: string;
  startedAt: string;
  durationMs: number;
}

interface AgentRunDto {
  id: string;
  status: string;
  otelTraceId: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: string | null;
  durationMs: number | null;
}

interface TraceResponse {
  runs: Array<{ run: AgentRunDto; spans: AgentRunSpanDto[] }>;
  traceStoreUnavailable: boolean;
}

/** Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — mirrors
 * `LinkedConversationSummary` (`@nextbot/conversations`) for this client component's
 * own typing. */
interface LinkedConversationDto {
  conversationId: string;
  channelId: string;
  channelType: string | null;
  status: string;
  startedAt: string;
  lastActivityAt: string;
}

const SENDER_VARIANT: Record<string, "default" | "secondary" | "outline"> = { Customer: "default", AI: "secondary", HumanAgent: "secondary", System: "outline" };
const STATUS_VARIANT: Record<ConversationStatusValue, "default" | "secondary" | "outline" | "destructive"> = {
  Active: "default",
  Resolved: "secondary",
  Escalated: "destructive",
  Abandoned: "outline",
};

function messageSummary(message: ConversationMessage): string {
  const payload = message.payload as { text?: string; title?: string };
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.title === "string") return payload.title;
  return `[${message.contentType}]`;
}

/** U3 fix (QA fix pass) — spec's three-band confidence color: green >0.85, amber
 * 0.60-0.85, red <0.60 (screen inventory B.4.2). */
function confidenceColor(score: number): "green" | "amber" | "red" {
  if (score > 0.85) return "green";
  if (score >= 0.6) return "amber";
  return "red";
}

const CONFIDENCE_BADGE_CLASS: Record<"green" | "amber" | "red", string> = {
  green: "bg-emerald-700 text-white",
  // QA fix (Batch D retry 1): amber-600/white failed WCAG AA (~3.19:1) — see
  // `WARNING_BADGE_CLASS`'s doc comment for the verified replacement/rationale.
  amber: WARNING_BADGE_CLASS,
  red: "bg-destructive text-white",
};

const CONFIDENCE_BAR_CLASS: Record<"green" | "amber" | "red", string> = {
  green: "[&_[data-slot=progress-indicator]]:bg-emerald-700",
  amber: "[&_[data-slot=progress-indicator]]:bg-amber-600",
  red: "[&_[data-slot=progress-indicator]]:bg-destructive",
};

/** U3 fix (QA fix pass) — a message's per-turn confidence, rendered as a small
 * colored bar + numeric readout next to each AI message. */
function ConfidenceGauge({ score }: { score: number }) {
  const color = confidenceColor(score);
  return (
    <div className="flex max-w-[140px] items-center gap-2">
      <Progress value={score * 100} aria-label="AI confidence" className={cn("flex-1", CONFIDENCE_BAR_CLASS[color])} />
      <span className="text-xs text-muted-foreground">{Math.round(score * 100)}%</span>
    </div>
  );
}

/** U3 fix (QA fix pass) — conversation-level confidence trend across every AI message
 * with a recorded `confidenceScore`, oldest to newest, rendered as a minimal inline
 * sparkline (no charting library dependency needed for a single-series trend of this
 * size — LLD is silent on a specific charting library, and adding one for a single
 * sparkline would fail the ADR's "don't add a dependency the LLD doesn't list
 * without checking it against the maturity bar" test for no real benefit here). */
function ConfidenceTrendSparkline({ scores }: { scores: number[] }) {
  if (scores.length === 0) return null;
  const width = 160;
  const height = 32;
  const stepX = scores.length > 1 ? width / (scores.length - 1) : 0;
  const points = scores.map((s, i) => `${i * stepX},${height - s * height}`).join(" ");
  const last = scores[scores.length - 1] as number;
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="text-sm text-muted-foreground">Confidence trend</span>
      <svg width={width} height={height} role="img" aria-label={`Confidence trend, latest ${Math.round(last * 100)}%`}>
        <polyline points={points} fill="none" stroke="#805AD5" strokeWidth={2} />
      </svg>
      <Badge className={CONFIDENCE_BADGE_CLASS[confidenceColor(last)]}>{Math.round(last * 100)}% latest</Badge>
    </div>
  );
}

/** Parsed shape of a `ModelCall` span's goal-recognition/tool-selection attributes —
 * U5 fix (QA fix pass): the reasoning block renders these as distinct human-readable
 * fields instead of a raw `JSON.stringify` dump of `span.attributes`. Attribute keys
 * come from `turn-pipeline.ts`'s `recordTurnSpan` calls (`goal-selection.ts`'s
 * `selectGoalAndTool` result and `param-extract.ts`'s extracted tool/args). */
interface ParsedReasoning {
  /** `goal_selection` span's `action` attribute (e.g. `UseTool`/`Clarify`/`Refuse` —
   * `goal-selection.ts`'s `GoalSelectionResult.action`) — the closest thing this
   * span kind has to a "recognized goal" label. */
  goal: string | null;
  tool: string | null;
  confidence: number | null;
  payload: Record<string, unknown> | null;
}

/** U5 fix (QA fix pass) — turns a span's raw `attributes` string-map (see
 * `turn-pipeline.ts`'s `recordTurnSpan` call sites: `goal_selection` spans carry
 * `action`/`toolName`/`confidence`; `tool_call:*` spans carry `toolName`/`args` as a
 * masked-JSON string) into the goal-recognized / tool-selected / payload shape the
 * spec's reasoning block calls for, instead of a raw JSON dump. */
function parseReasoningAttributes(attributes: Record<string, string>): ParsedReasoning {
  const goal = attributes.action ?? null;
  const tool = attributes.toolName || null;
  const confidence = attributes.confidence !== undefined ? Number(attributes.confidence) : null;
  let payload: Record<string, unknown> | null = null;
  const rawArgs = attributes.args ?? null;
  if (rawArgs) {
    try {
      payload = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }
  return { goal, tool, confidence: confidence !== null && !Number.isNaN(confidence) ? confidence : null, payload };
}

/** One AI message's expandable "reasoning" block (Phase 13, BL-06, screen inventory
 * B.4.2): goal recognition + tool selection + payload, backed by its `agent_run`'s
 * `ModelCall`/`ToolCall` spans. Reuses the disclosure/`Collapsible` pattern already
 * established for the Channels screen's embed snippet — no new expand/collapse
 * interaction pattern introduced for this screen.
 *
 * U5 fix (QA fix pass): renders each `ModelCall` span's parsed goal/tool/confidence
 * as distinct labeled fields (via `parseReasoningAttributes`) instead of a raw
 * `JSON.stringify(span.attributes)` dump — the non-`ModelCall` spans (tool-call
 * execution) still get their own collapsible input/output JSON via `ToolCallCard`
 * in the timeline below, so nothing here duplicates that raw-JSON view.
 */
function ReasoningBlock({ run, spans }: { run: AgentRunDto; spans: AgentRunSpanDto[] }) {
  const [open, setOpen] = useState(false);
  const modelCallSpans = spans.filter((s) => s.kind === "ModelCall");
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2 rounded-none border p-2">
      <CollapsibleTrigger
        render={
          <Button size="xs" variant="link">
            {open ? "Hide reasoning trace" : "Show reasoning trace"}
          </Button>
        }
      />
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Run status:</span>
            <Badge variant={run.status === "Succeeded" ? "default" : run.status === "Failed" ? "destructive" : "outline"}>{run.status}</Badge>
            <span>Trace ID:</span>
            <code className="text-xs">{run.otelTraceId}</code>
          </div>
          {modelCallSpans.length === 0 ? (
            <p className="text-xs text-muted-foreground">No reasoning spans recorded for this run.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {modelCallSpans.map((s) => {
                const parsed = parseReasoningAttributes(s.attributes);
                return (
                  <div key={s.spanId} className="rounded-none border p-2">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium">{s.name}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={s.status === "Ok" ? "default" : "destructive"}>{s.status}</Badge>
                        <span className="text-muted-foreground">{s.durationMs}ms</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Goal recognized</span>
                        <span className="font-medium">{parsed.goal ?? "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tool selected</span>
                        <span className="font-medium">{parsed.tool ?? "—"}</span>
                      </div>
                      {parsed.confidence !== null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Confidence</span>
                          <Badge className={CONFIDENCE_BADGE_CLASS[confidenceColor(parsed.confidence)]}>{Math.round(parsed.confidence * 100)}%</Badge>
                        </div>
                      )}
                      {parsed.payload && (
                        <div>
                          <p className="mb-1 text-muted-foreground">Payload</p>
                          <pre className="whitespace-pre-wrap p-1 text-xs">{JSON.stringify(parsed.payload, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** U4/U5 fix (QA fix pass) — an inline, per-message expandable tool-call card
 * (screen inventory B.4.2's "inline transcript tool-call cards"), distinct from the
 * conversation-level Tool-call timeline below: shows the backend/connector-facing
 * tool name as a badge plus collapsible input-args/output JSON, scoped to just the
 * tool calls that belong to this one message's run. */
function ToolCallCard({ span }: { span: AgentRunSpanDto }) {
  const [open, setOpen] = useState(false);
  const toolName = span.attributes.toolName || span.name;
  let inputJson: string | null = null;
  try {
    inputJson = span.attributes.args ? JSON.stringify(JSON.parse(span.attributes.args), null, 2) : null;
  } catch {
    inputJson = span.attributes.args ?? null;
  }
  const outcome = span.attributes.outcome ?? null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2 rounded-none border border-purple-200 p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs">
          <Badge className="bg-purple-700 text-white">{toolName}</Badge>
          <Badge variant={span.status === "Ok" ? "default" : "destructive"}>{outcome ?? span.status}</Badge>
        </div>
        <CollapsibleTrigger
          render={
            <Button size="xs" variant="link">
              {open ? "Hide details" : "Show details"}
            </Button>
          }
        />
      </div>
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-1 text-xs">
          <p className="text-muted-foreground">Input args (masked)</p>
          <pre className="whitespace-pre-wrap p-1">{inputJson ?? "—"}</pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-07, Blueprint §7.5's closing
 * note) — "citations are rendered in Conversations, Runtime Traces and the customer
 * widget." This is the Conversations half: a grounded/ungrounded AI message's real
 * structured citations (collection/document/chunk, and — for graph retrieval — the
 * relation path) render directly under the transcript bubble, not merely inline text.
 */
function CitationList({ citations }: { citations: CitationDto[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1 rounded-none border border-blue-200 bg-blue-50 p-2 text-xs">
      <p className="font-medium text-blue-900">Sources ({citations.length})</p>
      {citations.map((c, idx) => (
        <div key={`${c.chunkId}-${idx}`} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <Badge variant="outline">{c.collectionName}</Badge>
            <span className="text-muted-foreground">{c.documentTitle}</span>
          </div>
          {c.relationPath && c.relationPath.length > 0 && (
            <p className="text-muted-foreground">
              {c.relationPath.map((p) => `${p.srcName} —${p.relation}→ ${p.dstName}`).join("; ")}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** The "Retrieval" span kind's own inline card — strategy/outcome/hops/expansions/
 *  cost + the same structured citations list above, so a curator investigating a
 *  Refused/Ungrounded turn can see exactly what the bounded retrieval agent tried,
 *  not merely the final customer-facing fallback text. */
function RetrievalCard({ span }: { span: AgentRunSpanDto }) {
  const [open, setOpen] = useState(false);
  const outcome = span.attributes.outcome ?? "Unknown";
  let citations: CitationDto[] = [];
  try {
    citations = span.attributes.citations ? (JSON.parse(span.attributes.citations) as CitationDto[]) : [];
  } catch {
    citations = [];
  }
  const OUTCOME_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    Grounded: "default",
    Ungrounded: "secondary",
    Refused: "destructive",
    BudgetTruncated: "outline",
    Stale: "outline",
  };
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2 rounded-none border border-blue-200 p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs">
          <Badge className="bg-blue-700 text-white">{span.attributes.strategy ?? "Retrieval"}</Badge>
          <Badge variant={OUTCOME_VARIANT[outcome] ?? "outline"}>{outcome}</Badge>
        </div>
        <CollapsibleTrigger
          render={
            <Button size="xs" variant="link">
              {open ? "Hide retrieval detail" : "Show retrieval detail"}
            </Button>
          }
        />
      </div>
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Hops / Expansions</span>
            <span>
              {span.attributes.hops ?? "0"} / {span.attributes.expansions ?? "0"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cost</span>
            <span>${Number(span.attributes.costUsd ?? "0").toFixed(6)}</span>
          </div>
          <CitationList citations={citations} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Conversation Detail / Trace Viewer (Phase 13, BL-06, screen inventory B.4.2):
 * transcript with per-message expandable reasoning blocks, a tool-call timeline
 * derived from the same span data, a context panel, and the raw event log (each
 * span's raw attribute payload, expandable inline above).
 */
export function ConversationDetail({ conversationId, permissionLevel }: { conversationId: string; permissionLevel: PermissionLevelValue }) {
  const [conversation, setConversation] = useState<ConversationDetailData | null>(null);
  const [trace, setTrace] = useState<TraceResponse | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  // U4 fix (QA fix pass): the message a timeline tool-call row was clicked for —
  // scrolled-to and visually highlighted in the transcript.
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // U8 fix (QA fix pass): client-side filter/search over the raw event log.
  const [eventLogQuery, setEventLogQuery] = useState("");
  // Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08): every OTHER conversation
  // sharing this customer's identity (always `[]` unless the tenant has explicitly
  // opted in AND this conversation has a recorded identifier — see
  // `resolveLinkedConversations()`'s own doc comment).
  const [linkedConversations, setLinkedConversations] = useState<LinkedConversationDto[]>([]);
  const [editingIdentifier, setEditingIdentifier] = useState(false);
  const [identifierDraft, setIdentifierDraft] = useState("");
  const [identifierBusy, setIdentifierBusy] = useState(false);
  const [identifierError, setIdentifierError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [detailResult, traceResult, linkedResult] = await Promise.all([
        fetchJson<{ conversation: ConversationDetailData }>(`/api/v1/admin/conversations/${conversationId}`),
        fetchJson<TraceResponse>(`/api/v1/admin/conversations/${conversationId}/trace`),
        fetchJson<{ linked: LinkedConversationDto[] }>(`/api/v1/admin/conversations/${conversationId}/linked`),
      ]);
      if (detailResult.kind === "forbidden") {
        setForbidden(true);
        return;
      }
      if (detailResult.kind === "error" && detailResult.status === 404) {
        setNotFound(true);
        return;
      }
      if (detailResult.kind === "ok") setConversation(detailResult.data.conversation);
      else if (detailResult.kind === "error") setError(detailResult.message);

      if (traceResult.kind === "ok") setTrace(traceResult.data);
      // A forbidden/error result on the linked-conversations fetch alone (e.g. a
      // transient issue) never blocks the rest of the page — it just leaves the
      // "Linked conversations" panel empty, matching this feature's own fail-closed
      // default. Defensive `?? []` also covers a malformed/unexpected response shape
      // (e.g. a test double that doesn't model this specific endpoint) the same way.
      if (linkedResult.kind === "ok") setLinkedConversations(linkedResult.data.linked ?? []);
    })();
  }, [conversationId]);

  /** Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — records a customer
   * identifier the admin/agent has confirmed during this live conversation (see this
   * feature's own PATCH route handler doc for why no OTP/cryptographic verification
   * step exists). Re-fetches the linked-conversations panel afterward, since setting
   * an identifier can newly produce a match. */
  async function saveCustomerIdentifier() {
    if (!identifierDraft.trim()) return;
    setIdentifierBusy(true);
    setIdentifierError(null);
    try {
      const result = await fetchJson(`/api/v1/admin/conversations/${conversationId}/customer-identifier`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerIdentifier: identifierDraft.trim() }),
      });
      if (result.kind !== "ok") {
        setIdentifierError(result.kind === "error" ? result.message : "Could not save the customer identifier.");
        return;
      }
      setConversation((prev) => (prev ? { ...prev, customerIdentifier: identifierDraft.trim() } : prev));
      setEditingIdentifier(false);
      const linkedResult = await fetchJson<{ linked: LinkedConversationDto[] }>(`/api/v1/admin/conversations/${conversationId}/linked`);
      if (linkedResult.kind === "ok") setLinkedConversations(linkedResult.data.linked);
    } finally {
      setIdentifierBusy(false);
    }
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Conversations" />;
  if (notFound) return <p className="text-muted-foreground">This conversation could not be found.</p>;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!conversation) return <Skeleton className="h-32 w-full" role="status" aria-label="Loading conversation" />;

  const runsByRunId = new Map((trace?.runs ?? []).map((r) => [r.run.id, r]));
  const allSpans = (trace?.runs ?? []).flatMap((r) => r.spans.map((s) => ({ ...s, runId: r.run.id })));
  const toolCallSpans = allSpans.filter((s) => s.kind === "ToolCall").sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  // U3 fix (QA fix pass): every AI message's recorded confidence, oldest-to-newest,
  // feeding the conversation-level trend sparkline.
  const confidenceScores = conversation.messages
    .filter((m) => m.sender === "AI" && typeof m.confidenceScore === "number")
    .map((m) => m.confidenceScore as number);
  // U4 fix (QA fix pass): message(s) produced by a given tool-call's run, so a
  // timeline row click can scroll/highlight the right transcript entry.
  const messagesByRunId = new Map<string, ConversationMessage[]>();
  for (const m of conversation.messages) {
    if (!m.agentRunId) continue;
    const list = messagesByRunId.get(m.agentRunId) ?? [];
    list.push(m);
    messagesByRunId.set(m.agentRunId, list);
  }

  function scrollToMessage(runId: string) {
    const target = messagesByRunId.get(runId)?.[0];
    if (!target) return;
    setHighlightedMessageId(target.id);
    messageRefs.current.get(target.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const filteredEventLog = eventLogQuery.trim()
    ? allSpans.filter((s) => JSON.stringify(s).toLowerCase().includes(eventLogQuery.trim().toLowerCase()))
    : allSpans;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Conversation</h1>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[conversation.status]} className="px-2 py-1 text-sm">
            {conversation.status}
          </Badge>
          {/* QA Final Review S1: the spec calls for a "Replay in Test Console"
              affordance, but no Test Console route exists in this build yet —
              the previous placeholder linked to `/test-console?...`, which 404s.
              Rather than ship a dead link, this is now an honestly-disabled
              button with a tooltip explaining why, until a real Test Console
              route exists to point it at. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <span tabIndex={0} className="inline-block">
                  <Button size="sm" variant="outline" disabled aria-disabled="true">
                    Replay in Test Console
                  </Button>
                </span>
              }
            />
            <TooltipContent>Test Console isn&apos;t available yet in this build.</TooltipContent>
          </Tooltip>
          {/* Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-16) — one action
              promotes this conversation's own transcript into an eval case,
              pre-filled for admin confirmation before it's added to a suite. */}
          <HarvestEvalCaseButton
            source="HarvestedConversation"
            sourceRef={conversation.id}
            defaultName={`Conversation ${conversation.id.slice(0, 8)}`}
            transcript={conversation.messages.map((m) => ({ sender: m.sender, text: messageSummary(m) }))}
          />
        </div>
      </div>

      {trace?.traceStoreUnavailable && (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>
            The trace store is temporarily unavailable — reasoning traces may be incomplete right now. This is different from &quot;no trace recorded.&quot;
          </AlertDescription>
        </Alert>
      )}

      {confidenceScores.length > 0 && <ConfidenceTrendSparkline scores={confidenceScores} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <h2 className="mb-3 font-heading text-sm font-semibold">Transcript</h2>
          <div className="flex flex-col gap-3">
            {conversation.messages.map((m) => {
              const runData = m.agentRunId ? runsByRunId.get(m.agentRunId) : undefined;
              const toolCallSpansForRun = runData?.spans.filter((s) => s.kind === "ToolCall") ?? [];
              // Target Architecture Blueprint Phase 10 (BL-41, FR-KB-06/07).
              const retrievalSpansForRun = runData?.spans.filter((s) => s.kind === "Retrieval") ?? [];
              return (
                <div
                  key={m.id}
                  ref={(el) => {
                    if (el) messageRefs.current.set(m.id, el);
                  }}
                  className={cn(
                    "rounded-none border p-3",
                    highlightedMessageId === m.id && "border-amber-400 bg-amber-50",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <Badge variant={SENDER_VARIANT[m.sender] ?? "outline"}>{m.sender}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</span>
                  </div>
                  <p>{messageSummary(m)}</p>
                  {/* Target Architecture Blueprint Phase 10 (BL-41, FR-KB-07) — a
                      grounded/ungrounded reply's real structured citations, rendered
                      straight off the message's own persisted payload (never
                      recomputed client-side). */}
                  {m.payload.citations && m.payload.citations.length > 0 && <CitationList citations={m.payload.citations} />}
                  {m.sender === "AI" && typeof m.confidenceScore === "number" && (
                    <div className="mt-1">
                      <ConfidenceGauge score={m.confidenceScore} />
                    </div>
                  )}
                  {/* U5 fix (QA fix pass): inline expandable tool-call card(s) for
                      whichever tool call(s) this AI message's run made. */}
                  {toolCallSpansForRun.map((s) => (
                    <ToolCallCard key={s.spanId} span={s} />
                  ))}
                  {/* Target Architecture Blueprint Phase 10 (BL-41, FR-KB-06/07) — the
                      bounded retrieval agent's own span, incl. for a `Refused` turn
                      whose transcript message carries no `citations` at all. */}
                  {retrievalSpansForRun.map((s) => (
                    <RetrievalCard key={s.spanId} span={s} />
                  ))}
                  {runData && <ReasoningBlock run={runData.run} spans={runData.spans} />}
                </div>
              );
            })}
          </div>

          <Separator className="my-6" />
          <h2 className="mb-3 font-heading text-sm font-semibold">Tool-call timeline</h2>
          {toolCallSpans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tool calls recorded for this conversation.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {toolCallSpans.map((s) => {
                const backendName = s.attributes.toolName || s.name;
                let inputJson: string | null = null;
                try {
                  inputJson = s.attributes.args ? JSON.stringify(JSON.parse(s.attributes.args), null, 2) : null;
                } catch {
                  inputJson = s.attributes.args ?? null;
                }
                const relatedMessage = messagesByRunId.get(s.runId)?.[0];
                const outputPreview = relatedMessage ? messageSummary(relatedMessage) : null;
                return <TimelineToolCallRow key={s.spanId} span={s} backendName={backendName} inputJson={inputJson} outputPreview={outputPreview} onFocusMessage={() => scrollToMessage(s.runId)} />;
              })}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 font-heading text-sm font-semibold">Context</h2>
          <div className="mb-6 flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              {/* U1 fix (QA fix pass): the context panel previously fetched
                  `customerIdentifier` but never rendered it. Masked the same way
                  as the Conversation List's customer column (last 4 chars only). */}
              <span className="text-muted-foreground">Customer</span>
              <span>{maskCustomerIdentifierDetail(conversation.customerIdentifier)}</span>
            </div>
            {/* Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08): recording a
                confirmed customer identifier is the one bounded mechanism this phase
                gives a WIDGET conversation (which never gets one automatically) to
                become linkable across channels — write-gated, matching this screen's
                other admin-only actions. */}
            {permissionLevel === "Write" && (
              <div>
                {editingIdentifier ? (
                  <div className="flex flex-col gap-1">
                    <Input
                      aria-label="Confirmed customer identifier"
                      placeholder="Phone number or email the customer confirmed"
                      value={identifierDraft}
                      onChange={(e) => setIdentifierDraft(e.target.value)}
                    />
                    {identifierError && <p className="text-xs text-destructive">{identifierError}</p>}
                    <div className="flex gap-2">
                      <Button size="xs" disabled={identifierBusy || !identifierDraft.trim()} onClick={saveCustomerIdentifier}>
                        {identifierBusy ? "Saving…" : "Save"}
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setEditingIdentifier(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setIdentifierDraft(conversation.customerIdentifier ?? "");
                      setIdentifierError(null);
                      setEditingIdentifier(true);
                    }}
                  >
                    {conversation.customerIdentifier ? "Update identifier" : "Record confirmed identifier"}
                  </Button>
                )}
              </div>
            )}
            {linkedConversations.length > 0 && (
              <div className="rounded-none border p-2">
                <p className="mb-1 text-xs font-bold">Linked conversations (other channels)</p>
                <div className="flex flex-col gap-1">
                  {linkedConversations.map((lc) => (
                    <NextLink key={lc.conversationId} href={`/conversations/${lc.conversationId}`} className="text-xs text-primary underline-offset-4 hover:underline">
                      {lc.channelType ?? "Unknown channel"} — {lc.status} — last active {new Date(lc.lastActivityAt).toLocaleString()}
                    </NextLink>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Recognized task</span>
              <span>{conversation.recognizedGoal ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Resolution</span>
              <span>{conversation.resolutionType ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Language</span>
              <span>{conversation.language}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Started</span>
              <span>{new Date(conversation.startedAt).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ended</span>
              <span>{conversation.endedAt ? new Date(conversation.endedAt).toLocaleString() : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cost</span>
              <span>${Number(conversation.totalCostUsd).toFixed(4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tokens (in/out)</span>
              <span>
                {conversation.totalTokensIn} / {conversation.totalTokensOut}
              </span>
            </div>
          </div>

          <h2 className="mb-3 font-heading text-sm font-semibold">Raw event log</h2>
          {allSpans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trace events recorded yet.</p>
          ) : (
            <>
              <Input
                className="mb-2"
                placeholder="Filter events (span name, kind, attribute value...)"
                value={eventLogQuery}
                onChange={(e) => setEventLogQuery(e.target.value)}
                aria-label="Filter raw event log"
              />
              {filteredEventLog.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events match &quot;{eventLogQuery}&quot;.</p>
              ) : (
                // QA fix (Batch C retry 1, Defect 2): this region scrolls internally
                // (`overflow-y-auto`/`max-h-[400px]`) but had no `tabIndex`, so
                // keyboard-only users had no way to focus it and scroll with arrow
                // keys (axe-core `scrollable-region-focusable`). `tabIndex={0}` plus
                // an explicit `role`/`aria-label` makes it a focusable, labeled
                // scroll region.
                <pre
                  tabIndex={0}
                  role="region"
                  aria-label="Raw event log"
                  className="max-h-[400px] overflow-y-auto whitespace-pre-wrap p-2 text-xs"
                >
                  {JSON.stringify(filteredEventLog, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** U1 fix (QA fix pass) — same masking convention as the Conversation List's
 * customer column (last 4 chars only; never the raw identifier). */
function maskCustomerIdentifierDetail(identifier: string | null): string {
  if (!identifier) return "—";
  if (identifier.length <= 4) return identifier;
  return `••••${identifier.slice(-4)}`;
}

/** U4 fix (QA fix pass) — one Tool-call timeline row: backend/connector name,
 * collapsible input-args JSON, collapsible output preview, and a click handler that
 * scrolls/highlights the transcript message this tool call belongs to. */
function TimelineToolCallRow({
  span,
  backendName,
  inputJson,
  outputPreview,
  onFocusMessage,
}: {
  span: AgentRunSpanDto;
  backendName: string;
  inputJson: string | null;
  outputPreview: string | null;
  onFocusMessage: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-none border p-2 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge className="bg-purple-700 text-white">{backendName}</Badge>
          <Button size="xs" variant="link" onClick={onFocusMessage}>
            Jump to message
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={span.status === "Ok" ? "default" : "destructive"}>{span.status}</Badge>
          <span className="text-muted-foreground">{span.durationMs}ms</span>
          <CollapsibleTrigger
            render={
              <Button size="xs" variant="link">
                {open ? "Hide JSON" : "Show JSON"}
              </Button>
            }
          />
        </div>
      </div>
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-1 text-xs">
          <p className="text-muted-foreground">Input args (masked)</p>
          <pre className="whitespace-pre-wrap p-1">{inputJson ?? "—"}</pre>
          <p className="text-muted-foreground">Output</p>
          <pre className="whitespace-pre-wrap p-1">{outputPreview ?? "—"}</pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
