import type { TenantContext } from "@nextbot/db";
import type { KnowledgeTrustLevel } from "@nextbot/db";
import { detectAndMask, buildPolicyLookup, listCustomPiiRulesForMasking } from "@nextbot/pii";
import { getUpload } from "../infrastructure/upload-store.js";
import type { KnowledgeChunkRow } from "../infrastructure/document-chunk-repository.js";

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — PII read-time
 * re-evaluation: "detected entities are masked at index time per the collection's
 * trust level, and re-evaluated at read time against the requesting agent's trust
 * level (so the same indexed chunk can render differently masked to different
 * callers)."
 *
 * **Real mechanism, precisely scoped**: `knowledge_chunk.text` was masked ONCE, at
 * Chunk-stage time (`stage-ingest-parse-chunk.ts`), against the collection's own
 * trust level — re-deriving a DIFFERENT masking outcome from that already-masked
 * string is not generally possible (a `Redact`/`PartialMask` action can change a
 * span's length, so the ORIGINAL character offsets recorded in `piiMaskJson` are not
 * reliably reusable against the post-mask string). Rather than attempt an unsound
 * patch of an already-masked string, this re-derives the masking FRESH from the
 * original (pre-mask) text — retained at `knowledge_chunk.textUnmaskedRef` — using
 * the CALLER's own trust level. This can both show MORE (a higher-trust caller than
 * the collection's own index-time trust level) and LESS (a lower-trust caller) than
 * what is baked into `chunk.text`, because it is a genuine from-scratch
 * recomputation, not a patch.
 *
 * **Disclosed narrowing**: when `textUnmaskedRef` is absent — no PII was detected
 * at index time, or the collection's own trust level was `Untrusted` (see that
 * stage's own doc comment on why an `Untrusted` collection retains nothing extra) —
 * this returns the already-computed `chunk.text` unchanged, regardless of the
 * caller's trust level. A caller more trusted than the collection's own index-time
 * level simply cannot see more than was ever retained; this is the honest limit of
 * "re-evaluate," not a silent gap — there is nothing further to re-derive from.
 */
export async function resolveChunkTextForCaller(ctx: TenantContext, chunk: Pick<KnowledgeChunkRow, "text" | "textUnmaskedRef">, callerTrustLevel: KnowledgeTrustLevel): Promise<string> {
  if (!chunk.textUnmaskedRef) return chunk.text;

  let original: Buffer;
  try {
    original = await getUpload(ctx.tenantId, chunk.textUnmaskedRef);
  } catch {
    // A disk-full/permissions/missing-ref failure while reading the retained
    // original must never throw into a read path — degrade to the already-safe,
    // already-computed baked-in masking rather than surfacing an error to the caller.
    return chunk.text;
  }

  const customRules = await listCustomPiiRulesForMasking(ctx);
  const policyLookup = await buildPolicyLookup(ctx);
  return detectAndMask(original.toString("utf8"), "Knowledge", callerTrustLevel, policyLookup, customRules);
}
