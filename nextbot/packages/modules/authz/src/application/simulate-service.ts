import type { TenantContext } from "@nextbot/db";
import {
  AuthzRefNotYetSupportedError,
  type AuthzSimulateChainRef,
  type AuthzSimulateRequest,
  type AuthzSimulateResponse,
  type ScopeDescriptor,
} from "@nextbot/contracts";
import { getSkillVersion, getSkill } from "@nextbot/skills";
import { evaluateOrDeny } from "./evaluate-or-deny.js";
import { getTenantScopePolicy } from "./tenant-scope-policy-service.js";

/**
 * LLD §14.2.7 — `POST /api/v1/admin/authz/simulate`. Resolves each `chain` element
 * to a real `ScopeDescriptor` and then calls **the exact same** `evaluateOrDeny()`
 * the runtime's mandated call sites use — never a parallel approximation
 * (`intersect.test.ts`'s "same code path" test proves this: an all-`inline` chain
 * here and a direct `evaluateOrDeny()` call with the equivalent input produce
 * byte-identical results, because this function does nothing but resolve refs
 * before delegating to the one evaluator).
 *
 * **Ref resolution today**: `inline` always works. `skillVersion` resolves a real,
 * already-shipped artifact (Phase 5) into a `ScopeDescriptor`. `agentVersion` /
 * `teamVersion` / `teamMember` / `workflowVersion` / `workflowNode` throw
 * `AuthzRefNotYetSupportedError` (422) — none of those artifact kinds persist a
 * real `ScopeDescriptor` in this build yet: `agent_definition_version` has no
 * `scope_json` column (not part of this phase's schema scope), and
 * teams/workflows (Phase 14/15) don't exist as modules yet. This is a disclosed
 * limitation, not a silent gap — the error names exactly which ref kind isn't
 * resolvable and points the caller at the `inline` escape hatch.
 */
export async function simulate(ctx: TenantContext, request: AuthzSimulateRequest): Promise<AuthzSimulateResponse> {
  const tenantPolicy = await getTenantScopePolicy(ctx);
  const chain: ScopeDescriptor[] = [];
  for (const ref of request.chain) {
    chain.push(await resolveChainRef(ctx, ref));
  }
  return evaluateOrDeny(ctx, {
    tenantId: ctx.tenantId,
    tenantPolicy,
    chain,
    requested: request.requested,
    depth: request.depth ?? 0,
  });
}

async function resolveChainRef(ctx: TenantContext, ref: AuthzSimulateChainRef): Promise<ScopeDescriptor> {
  switch (ref.ref) {
    case "inline":
      return ref.scope;
    case "skillVersion":
      return resolveSkillVersionScope(ctx, ref.id);
    case "agentVersion":
    case "teamVersion":
    case "teamMember":
    case "workflowVersion":
    case "workflowNode":
      throw new AuthzRefNotYetSupportedError(ref.ref);
  }
}

/**
 * Maps a `skill_version` row's own locally-shaped `ScopeDescriptor`
 * (`@nextbot/skills`'s `domain/scope-descriptor.ts` — authored before this
 * evaluator existed, per that module's own doc comment: "ready to be handed to
 * that evaluator once it ships") onto LLD §14.2.2's real `ScopeDescriptorSchema`.
 *
 * Fields deliberately NOT mapped, disclosed: `knowledgeCollectionIds` (skills
 * stores tenant-authored collection *names*, not ids — Knowledge/Graph RAG
 * doesn't exist yet to resolve them against) and `budget` (skills' own
 * `{maxCostUsdPerConversation, maxLatencyMsP95}` shape has no field in common
 * with the evaluator's run/delegation-tree budget dimensions
 * `usdPerTurn`/`seconds`/`maxSteps`/`maxDepth`/`maxFanOut`/`maxDelegations`/
 * `maxHops`/`maxExpansions` — inventing a mapping between two unrelated concepts
 * would be worse than omitting it, per E3 "absent ⇒ ⊤").
 */
async function resolveSkillVersionScope(ctx: TenantContext, skillVersionId: string): Promise<ScopeDescriptor> {
  const version = await getSkillVersion(ctx, skillVersionId);
  const skill = await getSkill(ctx, version.skillId);
  const skillScope = version.scopeJson as {
    capabilityGroupIds: string[];
    toolIds: string[];
    rwClasses: ("Read" | "Write")[];
    autonomyCeiling: string | null;
  };
  return {
    origin: "Skill",
    originId: `${skill.name}@${version.version}`,
    originLabel: skill.name,
    capabilityGroupIds: skillScope.capabilityGroupIds,
    toolIds: skillScope.toolIds,
    // Empty means "the skill author never populated this field" (the schema
    // defaults it to `[]`), not "this skill explicitly restricts to zero rw
    // classes" — treated as absent (⊤) per E3, matching the same "absent ≠
    // empty" distinction the evaluator itself is built to preserve.
    rwClasses: skillScope.rwClasses && skillScope.rwClasses.length > 0 ? skillScope.rwClasses : undefined,
    autonomyCeiling: (skillScope.autonomyCeiling ?? undefined) as ScopeDescriptor["autonomyCeiling"],
  };
}
