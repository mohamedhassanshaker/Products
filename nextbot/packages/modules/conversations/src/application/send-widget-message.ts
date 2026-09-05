import type { MessagePayload, SendWidgetMessageRequest, SendWidgetMessageResult, MessageDto } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import type { WidgetSessionClaims } from "./widget-session-token.js";
import { findMessageByClientId, insertMessage, type MessageRow } from "../infrastructure/message-repository.js";
import { publishConversationEvent } from "../infrastructure/message-bus.js";
import { generatePlaceholderRunId, generateStubAiReply } from "./stub-turn-responder.js";

export interface SendWidgetMessageDeps {
  /** Computes the AI reply for one customer message. The composition root
   * (`apps/gateway`'s route handler) supplies the real Phase 12 turn pipeline here
   * (`@nextbot/orchestration`'s `runTurnPipeline` bound to `apps/gateway/src/lib/
   * mcp-egress.ts`'s `EgressPort`) — `conversations` (Data Plane) never imports
   * `orchestration` directly (LLD §2.3's module allow-list has no such edge; only
   * `apps/*`, the composition root, may wire the two together). Omitted (e.g. a test
   * that doesn't need real tool calls, or a caller that hasn't wired the Gateway
   * Plane yet) falls back to Phase 7's honestly-labeled placeholder reply rather
   * than throwing — documented, not a silent behavior change for existing callers.
   *
   * Phase 13 (BL-06) addition: returns `runId` alongside the reply so the persisted
   * AI message can be stamped with `message.agentRunId` — the join key the trace
   * viewer uses to correlate a transcript message back to its `agent_run`/spans.
   * `runId` is `null` for the placeholder responder and for any real turn that had
   * no `agentDefinitionVersionId` to create a run against (see
   * `@nextbot/orchestration`'s `TurnPipelineInput` doc).
   *
   * Phase 6 (client-feedback-batch item 9) addition: the 4th `previewVersionId`
   * param carries `WidgetSessionClaims.previewVersionId` straight through — set only
   * for a server-verified sandbox-preview session (see `create-widget-session.ts`).
   * The composition root's real implementation (`apps/gateway`'s
   * `turn-pipeline-adapter.ts`) uses it in place of its usual "this tenant's live
   * Production version" lookup, so a sandbox test conversation traces against the
   * exact version under test. */
  generateAiReply?: (ctx: TenantContext, input: GenerateAiReplyArgs) => Promise<{ payload: MessagePayload; runId: string | null }>;
}

/**
 * Target Architecture Blueprint Phase 17 (BL-48, LLD §15.6) — the arguments the
 * composition root's real turn-pipeline adapter needs.
 *
 * **Converted from four positional parameters to a single options object in this phase.**
 * LLD §15.6 explicitly leaves this as an implementation judgment; with `channelId` and
 * `liveMessageId` added it would otherwise be six positional parameters, three of them
 * strings and two of them optional — a shape where transposing two arguments at a call
 * site type-checks cleanly and silently routes a turn to the wrong channel's bot.
 */
export interface GenerateAiReplyArgs {
  customerPayload: MessagePayload;
  conversationId: string;
  /** Phase 17: the channel this turn arrived on — the first hop of
   *  `channel → agent definition → traffic split → version`. Already present on every
   *  widget session (`WidgetSessionClaims.channelId`); simply never threaded before. */
  channelId: string;
  /** Phase 17: the customer message that triggered this turn, already persisted. Used
   *  only as a shadow-evaluation POINTER — no transcript content is copied. */
  liveMessageId?: string;
  /** Phase 6 (client-feedback-batch item 9): a server-verified sandbox-preview version
   *  id, straight from `WidgetSessionClaims.previewVersionId`. Short-circuits version
   *  resolution so a sandbox conversation traces against the exact version under test. */
  previewVersionId?: string;
}

/**
 * FR-OC-01/FR-AI-04: persists an inbound widget message and the real Phase-12 turn
 * pipeline's AI reply (`@nextbot/orchestration`'s `runTurnPipeline` — see
 * `stub-turn-responder.ts`'s doc for why a placeholder existed through Phase 7-11),
 * publishing both to the conversation's SSE subscribers as they're written.
 * Idempotent on `clientMessageId` (LLD §5.3's offline-queue replay contract):
 * resending the same `clientMessageId` returns the original result rather than
 * creating a duplicate message or triggering a second AI turn.
 */
export async function sendWidgetMessage(
  session: WidgetSessionClaims,
  input: SendWidgetMessageRequest,
  deps: SendWidgetMessageDeps = {},
): Promise<SendWidgetMessageResult> {
  const ctx: TenantContext = { tenantId: session.tenantId, region: session.region, environment: session.environment };

  const existing = await findMessageByClientId(ctx, session.conversationId, input.clientMessageId);
  if (existing) {
    return {
      messageId: existing.id,
      sequence: existing.sequence,
      acceptedAt: existing.createdAt.toISOString(),
      runId: generatePlaceholderRunId(),
    };
  }

  const customerMessage = await insertMessage(ctx, {
    conversationId: session.conversationId,
    sender: "Customer",
    contentType: input.contentType,
    payload: input.payload as Record<string, unknown>,
    clientMessageId: input.clientMessageId,
  });

  if (customerMessage.reused) {
    // BE1: a genuinely concurrent request for the same clientMessageId already won
    // the insert race and will itself publish the customer-message SSE event and
    // generate the (single) AI reply — doing either again here would double both.
    return {
      messageId: customerMessage.id,
      sequence: customerMessage.sequence,
      acceptedAt: customerMessage.createdAt.toISOString(),
      runId: generatePlaceholderRunId(),
    };
  }

  publishConversationEvent(session.conversationId, { event: "message", data: { message: toDto(customerMessage) } });

  const { payload: aiPayload, runId: aiRunId } = await generateAiReply(ctx, deps, {
    customerPayload: input.payload,
    conversationId: session.conversationId,
    // Phase 17 (BL-48): the widget session has always carried `channelId`; this is the
    // first phase that had anything to do with it.
    channelId: session.channelId,
    // Phase 17 (BL-48, ADR-0019 §2.5): the customer message inserted immediately above,
    // used only as a shadow-evaluation pointer.
    liveMessageId: customerMessage.id,
    previewVersionId: session.previewVersionId,
  });
  const aiMessage = await insertMessage(ctx, {
    conversationId: session.conversationId,
    sender: "AI",
    contentType: aiPayload.contentType,
    payload: aiPayload as unknown as Record<string, unknown>,
    agentRunId: aiRunId,
  });
  publishConversationEvent(session.conversationId, { event: "message", data: { message: toDto(aiMessage) } });

  return {
    messageId: customerMessage.id,
    sequence: customerMessage.sequence,
    acceptedAt: customerMessage.createdAt.toISOString(),
    runId: aiRunId ?? generatePlaceholderRunId(),
  };
}

async function generateAiReply(ctx: TenantContext, deps: SendWidgetMessageDeps, args: GenerateAiReplyArgs): Promise<{ payload: MessagePayload; runId: string | null }> {
  if (!deps.generateAiReply) {
    // No Gateway-Plane turn-pipeline wired (e.g. a caller/test that predates Phase
    // 12) — fall back to the honestly-labeled Phase 7 placeholder rather than
    // throwing.
    return { payload: generateStubAiReply(args.customerPayload), runId: null };
  }
  return deps.generateAiReply(ctx, args);
}

function toDto(row: MessageRow): MessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    sequence: row.sequence,
    sender: row.sender,
    contentType: row.contentType,
    payload: row.payload,
    confidenceScore: row.confidenceScore,
    createdAt: row.createdAt.toISOString(),
    // D6 fix: only meaningful (and only ever set) for the customer's own message —
    // lets the widget frontend dedup its optimistic local bubble against this SSE
    // echo by clientMessageId, race-proof regardless of arrival order relative to
    // the HTTP response that otherwise reconciles the bubble's server-assigned id.
    clientMessageId: row.clientMessageId ?? undefined,
  };
}
