import { Type, type Static } from "@sinclair/typebox";
import { generateStructured } from "@nextbot/ai-registry";
import type { TenantContext } from "@nextbot/db";
import { listMessagesSince } from "@nextbot/conversations";
import { findEscalationById } from "../infrastructure/escalation-repository.js";

/** LLD §5.8 `DraftReplyResponse` shape (minus `modelRouteKey`/`costUsd`, which the
 * caller — the HTTP route — already knows/derives without needing the model to echo
 * them back). Re-validated by `generateStructured` itself; never hand-parsed. */
export const DraftReplySchema = Type.Object({
  draftText: Type.String({ minLength: 1 }),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
});
export type DraftReplyResult = Static<typeof DraftReplySchema>;

/**
 * FR-AI-08 — an AI-drafted reply the human agent may accept as-is, edit, or discard.
 * **Never auto-sent**: this function only returns text, exactly like Phase 14's
 * `Confirmation` card contract — sending requires the agent's own separate
 * `sendHumanAgentMessage` call. Uses the LLD §7.3 `summarize.escalation` model route
 * key (a distinct, cheaper-tier route than the turn-pipeline's own `reasoning.planner`
 * — LLD §7.4's model-route table), and `generateStructured` (TypeBox-validated,
 * re-validated on return, one repair attempt) — never a raw/hand-parsed completion.
 */
export async function draftAiSuggestion(ctx: TenantContext, escalationId: string): Promise<DraftReplyResult> {
  const escalation = await findEscalationById(ctx, escalationId);
  if (!escalation) throw new Error(`draftAiSuggestion: escalation ${escalationId} not found`);

  const transcript = await listMessagesSince(ctx, escalation.conversationId, 0);
  const recent = transcript.slice(-20);
  const transcriptText = recent
    .map((m) => `${m.sender}: ${m.contentType === "Text" && "text" in m.payload ? String(m.payload.text) : `[${m.contentType}]`}`)
    .join("\n");

  return generateStructured({
    routeKey: "summarize.escalation",
    schema: DraftReplySchema,
    system:
      "You are drafting a suggested reply for a human support agent who has just taken over an escalated customer " +
      "conversation. Read the transcript and the AI's own recorded context snapshot, then propose one helpful, " +
      "on-topic reply the agent can send as-is, edit, or discard. Never claim an action was taken that wasn't. " +
      `Escalation reason: ${escalation.reason}. AI context snapshot: ${JSON.stringify(escalation.aiContextSnapshot)}.`,
    messages: [{ role: "user", content: transcriptText || "(no prior transcript)" }],
  });
}
