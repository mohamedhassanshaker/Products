import type { TenantContext } from "@nextbot/db";
import { evaluateOrDeny, getTenantScopePolicy } from "@nextbot/authz";
import type { ApprovalTierValue, PermissionIntersectionResult, ScopeDescriptor } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 6 (BL-37, ADR-0012, LLD §14.2.5) — mandated
 * call site 1 of 5: "Every tool call, after §3.6's permission resolver, before
 * execution." `resolve()` (tier-engine.ts's `resolveToolPermission`) and
 * `evaluate()` are BOTH required and are not substitutes (LLD §14.2.5 is explicit
 * about this): `resolve()` answers "does a tenant permission *rule* allow this
 * tool here"; `evaluate()` answers "is this tool inside the composed scope of the
 * artifact chain that asked for it". This step runs strictly AFTER `resolve()`
 * has already produced a non-suspended, non-denied outcome, and strictly BEFORE
 * dispatch (`turn-pipeline.ts`'s `egress.invokeTool` call).
 *
 * **Disclosed narrowing — the caller-chain placeholder.** `agent_definition_
 * version` does not yet persist a real `scope_json` column in this build (that
 * schema addition isn't part of this phase's scope per the LLD's own Phase 6
 * section, which only specifies `packages/modules/authz` + `delegation_event`).
 * Until it does, this call site builds a `chain` of exactly one `AgentVersion`-
 * origin `ScopeDescriptor` that declares NO dimension (every field omitted ⇒ `⊤`
 * per E3) — an honest representation of "this artifact doesn't yet declare any
 * additional scope restriction beyond tenant policy", not a fabricated one. This
 * makes today's fold reduce to `tenantPolicy` alone, which is why this wiring is
 * **behavior-preserving** for every existing caller: `tenant_scope_policy`
 * currently only derives `allowOutOfRegionInference` (see
 * `packages/db/src/schema/authz.ts`), a dimension this call site's `requested`
 * never exercises (tool calls have no `targetRegion` concept in this codebase),
 * so `evaluate()` can never deny something the pre-existing pipeline previously
 * allowed. Once agent-platform gains a real per-version scope column, this file
 * is the only place that needs updating to thread it through.
 */
export interface ToolCallAuthzInput {
  agentDefinitionVersionId: string | null;
  toolId: string;
  toolCapabilityGroupId: string | null;
  toolRwClass: "Read" | "Write";
  toolApprovalTier: ApprovalTierValue;
}

/**
 * Runs the §14.2 evaluator for one tool call. Returns the same
 * `PermissionIntersectionResult` `/authz/simulate` would for the equivalent
 * chain — never a parallel approximation (both paths call `evaluateOrDeny()`,
 * the one exported implementation).
 */
export async function evaluateToolCallScope(ctx: TenantContext, input: ToolCallAuthzInput): Promise<PermissionIntersectionResult> {
  const tenantPolicy = await getTenantScopePolicy(ctx);

  const callerScope: ScopeDescriptor = {
    origin: "AgentVersion",
    originId: input.agentDefinitionVersionId ?? "unscoped",
    originLabel: input.agentDefinitionVersionId ?? "Unscoped turn (no deployed agent version resolved)",
    // Every dimension omitted deliberately — see this file's doc comment.
  };

  return evaluateOrDeny(ctx, {
    tenantId: ctx.tenantId,
    tenantPolicy,
    chain: [callerScope],
    requested: {
      kind: "ToolCall",
      toolId: input.toolId,
      toolCapabilityGroupId: input.toolCapabilityGroupId ?? undefined,
      toolRwClass: input.toolRwClass,
      toolApprovalTier: input.toolApprovalTier,
    },
    depth: 0,
  });
}
