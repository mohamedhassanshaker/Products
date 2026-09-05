import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/** Phase 6 (BL-30, FR-SEC-09) — one row per guardrail screening decision. This phase
 * only ever writes `action: "Blocked"` rows (a `PostToolResult` hit) — an `Allowed`
 * outcome is never written, matching `guardrail_rule`'s existing silent-pass
 * convention (LLD §14.9.1's future `OutputPolicy`/`Groundedness` stages may write
 * `Allowed` rows once they exist; recorded here as a deliberately narrow scope, not an
 * oversight). */
export interface RecordGuardrailEventInput {
  conversationId?: string | null;
  toolCallId?: string | null;
  kind: string;
  appliesAt: string;
  action: "Blocked" | "Allowed";
  detector: string;
  score?: number | null;
  matchedExcerptMasked?: string | null;
}

export async function recordGuardrailEvent(ctx: TenantContext, input: RecordGuardrailEventInput): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.guardrailEvent).values({
      id,
      tenantId: ctx.tenantId,
      conversationId: input.conversationId ?? null,
      toolCallId: input.toolCallId ?? null,
      kind: input.kind,
      appliesAt: input.appliesAt,
      action: input.action,
      detector: input.detector,
      score: input.score ?? null,
      matchedExcerptMasked: input.matchedExcerptMasked ?? null,
    });
  });
  return id;
}
