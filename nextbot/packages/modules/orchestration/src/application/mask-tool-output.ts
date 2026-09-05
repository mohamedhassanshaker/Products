import type { TenantContext } from "@nextbot/db";
import { buildPolicyLookup, listCustomPiiRulesForMasking, maskJsonValue } from "@nextbot/pii";

/**
 * QA Final Review S3 — a raw MCP tool result can contain real customer PII (the
 * observed QA case: a customer email address surfaced verbatim). Before this fix,
 * `render-selection.ts`'s `selectRenderedCard` ran directly against the
 * *unmasked* tool output, for both the structured-card paths and the raw-JSON
 * `Text` fallback — this is the composition seam (`turn-pipeline.ts`/
 * `approval-service.ts`, the application layer, since `render-selection.ts`
 * itself is a pure `domain/` file that can't do the I/O a real policy lookup
 * requires) that now masks the tool's raw output through the exact same
 * `@nextbot/pii` pipeline the audit log and A2A payloads already use, with the
 * `"ToolCallPayload"` context (LLD's own dedicated context for this data class)
 * before it ever reaches `selectRenderedCard`.
 *
 * `trustLevel` is fixed at `"Untrusted"` here, matching
 * `apps/web/src/lib/audit-query.ts`'s own justification: the masking-context
 * matrix's absent-combination default is `FullMask` (fail closed), so choosing
 * the least-privileged trust level can only make masking *more* conservative,
 * never accidentally reveal more than a tenant explicitly configured for
 * `Untrusted`. Plumbing the real per-connector `trust_level` through this call
 * chain is a reasonable future refinement, not required for this fix to be safe.
 */
export async function maskToolOutputForRendering(ctx: TenantContext, output: unknown): Promise<unknown> {
  const [resolvePolicy, customRules] = await Promise.all([buildPolicyLookup(ctx), listCustomPiiRulesForMasking(ctx)]);
  return maskJsonValue(output, "ToolCallPayload", "Untrusted", resolvePolicy, customRules);
}
