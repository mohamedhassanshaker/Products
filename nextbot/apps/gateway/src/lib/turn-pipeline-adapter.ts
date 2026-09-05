import { runTurnPipeline } from "@nextbot/orchestration";
import { triggerEscalation } from "@nextbot/escalations";
import { claimConcurrentRunSlot } from "@nextbot/tenancy";
import { listEnabledGuardrailRules } from "@nextbot/pii";
import { findAgentDefinitionIdForChannel } from "@nextbot/channels";
import { maybeEnqueueShadowRun, recordSandboxTest, resolveTurnAgentVersion } from "@nextbot/agent-platform";
import type { MessagePayload } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { createMcpEgressPort } from "./mcp-egress.js";

/**
 * The composition-root wiring between `@nextbot/conversations` (Data Plane,
 * `SendWidgetMessageDeps.generateAiReply`) and `@nextbot/orchestration`'s real Phase
 * 12 turn pipeline. Lives in `apps/gateway` specifically because neither module may
 * depend on the other directly (LLD §2.3's module allow-list) — only an app (the
 * composition root) may import both and bind them together.
 *
 * Returns the run id alongside the reply (Phase 13, BL-06) so the caller can stamp
 * `message.agentRunId`. **Phase 14 (BL-08) fix**: `conversationId` is now threaded
 * through for real — Tier-2/3 suspension structurally requires it (a `tool_call` row
 * must be scoped to a real conversation, LLD §6.2), and QA's Phase 12-13 pass had
 * already flagged that no real customer conversation ever supplied it, silently
 * defeating the trace viewer.
 *
 * **Target Architecture Blueprint Phase 17 (BL-48, ADR-0019, LLD §15.3/§15.6) — the
 * version resolution this function does is now the real one.** Until this phase it
 * called `findActiveAgentDefinitionVersion(ctx)`: a tenant-wide lookup returning the most
 * recently promoted `Production` version across *all* of the tenant's agent definitions,
 * with no channel, no agent definition, no weighting and no stickiness. LLD §7.4 step 4
 * and §9.1 both described a weighted/sticky traffic-split resolver that had in fact never
 * been built (ADR-0019 §1 records the verification). The full chain now runs here:
 *
 *   1. `channelId → channel.agent_definition_id` — which BOT answers on this channel
 *      (`findAgentDefinitionIdForChannel`). This module boundary is why the chain is
 *      split: `agent-platform` may not depend on `channels` (LLD §14.1), so the
 *      composition root resolves the id and passes it down.
 *   2. `resolveTurnAgentVersion` — which BUILD of that bot serves this conversation:
 *      sticky per conversation, bounded by the assigned deployment's `is_active`
 *      lifetime, otherwise a deterministic weighted walk over the active
 *      `deployment` rows.
 *
 * A channel with **no** binding (`agentDefinitionId === null`) falls back to the retained
 * tenant-wide lookup, so a tenant that has never touched the new "Answered by" selector
 * behaves byte-for-byte as it did before this phase — which is exactly what ADR-0019 §6
 * item 10 requires and what the unmodified widget/WhatsApp integration suites prove.
 *
 * **Phase 16 (BL-09) addition**: when the turn pipeline reports an
 * `escalationSignal` (one of FR-ESC-01's four trigger reasons), this composition root
 * — the only place both `@nextbot/orchestration` and `@nextbot/escalations` may be
 * imported together — calls `triggerEscalation` for real. A failure to create the
 * escalation record must never mask the customer-facing reply that already told them
 * they're being connected (best-effort: logged, not re-thrown into the request).
 *
 * **Phase 17 (BL-10) addition**: passes this tenant's real, enabled `guardrail_rule`
 * rows into the turn pipeline's `guardrailRules` param.
 *
 * **Phase 18 (BL-11, NFR-4/NFR-4a) addition**: claims a live `tenant_runtime_quota`
 * concurrent-run slot for the duration of this turn; the slot is always released in
 * `finally`, even on a thrown error, so a failed turn never permanently leaks capacity.
 *
 * **Phase 6 (client-feedback-batch item 9) addition**: `previewVersionId`, when present,
 * is a server-verified sandbox-preview version id. It short-circuits the whole resolution
 * chain above (ADR-0019 §2.3 step 0, unchanged) so a sandbox test conversation traces
 * against the exact version under test.
 *
 * **Phase 7 (client-feedback-batch item 6) addition**: a completed sandbox-preview turn
 * calls `recordSandboxTest` so the `Approved -> Production` gate can require real proof of
 * a completed sandbox turn. Best-effort, same rationale as the escalation `try/catch`.
 */
export interface GenerateAiReplyInput {
  /** The customer's own message payload for this turn. */
  customerPayload: MessagePayload;
  conversationId: string;
  /**
   * Phase 17 (BL-48, LLD §15.6): the channel this turn arrived on. Already available at
   * **both** live call sites and simply never threaded before —
   * `WidgetSessionClaims.channelId` exists on every widget session, and the WhatsApp
   * inbound handler already takes `channelId` as a parameter.
   */
  channelId: string;
  /**
   * Phase 17 (BL-48, ADR-0019 §2.5): the id of the customer message that triggered this
   * turn, already inserted by the caller before this function runs. Used only as the
   * `shadow_run` POINTER a later asynchronous replay dereferences — no transcript content
   * is copied anywhere.
   */
  liveMessageId?: string;
  /** Server-verified sandbox-preview override; short-circuits version resolution. */
  previewVersionId?: string;
}

export async function generateAiReply(ctx: TenantContext, input: GenerateAiReplyInput): Promise<{ payload: MessagePayload; runId: string | null }> {
  const { customerPayload, conversationId, channelId, liveMessageId, previewVersionId } = input;

  // Resolved before the quota slot is claimed: this is two cheap indexed reads, and doing
  // them inside the slot would hold a concurrency unit for work that is not the model call.
  const agentDefinitionId = previewVersionId ? null : await findAgentDefinitionIdForChannel(ctx, channelId);
  const resolved = previewVersionId
    ? null
    : await resolveTurnAgentVersion(ctx, {
        conversationId,
        agentDefinitionId,
        // Only `Production` has a live resolver consumer today (ADR-0019 §2.7's explicit
        // out-of-scope note); `environment` stays a real parameter so Staging/Sandbox
        // rollout workflows need no signature change when they are scoped.
        environment: "Production",
      });

  const releaseQuotaSlot = await claimConcurrentRunSlot(ctx);
  let result: Awaited<ReturnType<typeof runTurnPipeline>>;
  try {
    const egress = createMcpEgressPort(ctx);
    const dbGuardrailRules = await listEnabledGuardrailRules(ctx);
    // Adapts the pii module's `GuardrailRuleRow` (conditions nested under
    // `conditions.toolName`, matching the DB row shape) to orchestration's
    // `StubGuardrailRule` (a flat `toolName`, unchanged since Phase 12).
    const guardrailRules = dbGuardrailRules
      .filter((r) => r.conditions.toolName)
      .map((r) => ({ id: r.id, toolName: r.conditions.toolName!, effect: r.effect, reason: r.reason }));
    result = await runTurnPipeline(
      ctx,
      { egress },
      {
        customerText: extractCustomerText(customerPayload),
        conversationId,
        guardrailRules,
        agentDefinitionVersionId: previewVersionId ?? resolved?.agentDefinitionVersionId,
        // `executionMode` is deliberately left at its `"Live"` default here. The live
        // request path never runs a shadow turn — ADR-0019 §2.5 rejected the synchronous
        // dual-run outright — it only ENQUEUES one below, for `apps/worker` to replay.
      },
    );
  } finally {
    await releaseQuotaSlot();
  }

  if (result.escalationSignal) {
    try {
      await triggerEscalation(ctx, {
        conversationId,
        reason: result.escalationSignal.reason,
        reasonDetail: result.escalationSignal.detail,
        aiContextSnapshot: { ...result.escalationSignal.detail },
        // QA Final Review minor item (duplicate handoff message): the turn's own
        // reply payload IS `humanHandoffFallback()`'s identical
        // `HUMAN_HANDOFF_CONNECTING_TEXT` copy, already about to be inserted as
        // this turn's `AI`-sender message by `send-widget-message.ts` — posting
        // it again here as a `System`-sender message would be a real customer-
        // visible duplicate, not just a log artifact.
        skipConnectingMessage: true,
      });
    } catch (err) {
      // Best-effort: the customer-facing handoff/fallback text has already been
      // decided and must still be returned even if the queue-side record failed to
      // write (e.g. a transient DB error) — surfaced server-side only, never thrown
      // into the customer's own message-send request.
      console.error("triggerEscalation failed for conversation", conversationId, err);
    }
  }

  // Phase 17 (BL-48, ADR-0019 §2.5 step 1) — enqueue a shadow replay of the candidate
  // version, if an experiment is running for this agent+environment and the sampling roll
  // and ceilings allow it. Deliberately AFTER the reply is computed, and in the same
  // best-effort `try/catch` idiom `triggerEscalation` and `recordSandboxTest` already use:
  // shadow evaluation is an optional experiment, and a bookkeeping failure in it must
  // never mask a reply a customer is waiting on. Skipped entirely for a sandbox preview
  // (not real traffic) and for a turn with no resolved binding or no real run to compare
  // against — `shadow_run.live_agent_run_id` is the anchor of the whole comparison.
  if (!previewVersionId && agentDefinitionId && liveMessageId && result.runId) {
    try {
      await maybeEnqueueShadowRun(ctx, {
        agentDefinitionId,
        environment: "Production",
        conversationId,
        liveAgentRunId: result.runId,
        liveMessageId,
      });
    } catch (err) {
      console.error("maybeEnqueueShadowRun failed for conversation", conversationId, err);
    }
  }

  if (previewVersionId && result.runId) {
    try {
      await recordSandboxTest(ctx, previewVersionId);
    } catch (err) {
      // Best-effort, same rationale as the escalation try/catch above: this is
      // bookkeeping for a later promotion-gate check, not something the customer's
      // in-flight reply should ever fail on.
      console.error("recordSandboxTest failed for preview version", previewVersionId, err);
    }
  }

  return { payload: result.payload, runId: result.runId };
}

function extractCustomerText(payload: MessagePayload): string {
  switch (payload.contentType) {
    case "Text":
      return payload.text;
    case "QuickReply": {
      const chip = payload.chips.find((c) => c.id === payload.selectedChipId);
      return chip ? chip.label : (payload.text ?? "");
    }
    case "List": {
      const item = payload.items.find((i) => i.id === payload.selectedItemId);
      return item ? item.label : (payload.title ?? "");
    }
    case "Form":
      return Object.values(payload.values ?? {}).join(" ");
    default:
      return "";
  }
}
