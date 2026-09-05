import type { TenantContext } from "@nextbot/db";
import type { HarvestEvalCaseRequest } from "@nextbot/contracts";
import { createEvalCase, type EvalCaseRow } from "../infrastructure/eval-repository.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-16, LLD §14.9.3) — one
 * action from a conversation/escalation/denied-Tier-3-approval detail view
 * promotes it into an eval case. This function IS the "admin confirmation
 * before it is added to a suite" — it is called only once the console's own
 * pre-fill-then-confirm dialog has been submitted (never on merely opening the
 * detail view), so a case is never auto-added without confirmation.
 *
 * Deliberately thin: the pre-fill (transcript, expected behavior) is composed
 * client-side from the conversation/escalation/approval detail view's own
 * already-loaded data (this module owns no read access to `conversation`/
 * `escalation`/`approval_request` — those live in other modules, LLD §2.3's
 * allow-list) — this function's own job is exactly what FR-AGT-16 asks of the
 * SERVER side: persist the confirmed case with the right provenance stamped.
 */
export async function harvestEvalCase(ctx: TenantContext, input: HarvestEvalCaseRequest): Promise<EvalCaseRow> {
  return createEvalCase(ctx, {
    evalSuiteId: input.evalSuiteId,
    name: input.name,
    inputTranscript: input.inputTranscript,
    expectedResponsePattern: input.expectedResponsePattern,
    rubric: input.rubric,
    source: input.source,
    sourceRef: input.sourceRef,
  });
}
