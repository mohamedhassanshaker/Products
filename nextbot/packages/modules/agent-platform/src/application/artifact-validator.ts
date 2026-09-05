import { Value } from "@sinclair/typebox/value";
import type { TenantContext } from "@nextbot/db";
import { AgentDefinitionArtifactSchema, type AgentDefinitionArtifact, type ScopeDescriptor } from "@nextbot/contracts";
import { getTenantScopePolicy, assertTightensOnly } from "@nextbot/authz";

/**
 * **Disclosed path correction**: this dispatch's own brief names this file
 * `agent-platform/domain/artifact-validator.ts`; it lives under `application/`
 * instead. Every module's own `domain` layer is structurally enforced pure/
 * I/O-free (`.dependency-cruiser.cjs`'s `no-db-inside-domain` rule — confirmed
 * by running it: this file takes a `TenantContext` and calls `@nextbot/authz`'s
 * `getTenantScopePolicy`, a real Postgres read), so `domain` is not a legal
 * home for it regardless of the LLD's literal path. The exported symbol name,
 * behavior, and call sites are otherwise exactly as specified.
 *
 * Target Architecture Blueprint Phase 12 (BL-43/44, FR-AGT-13/14, LLD §14.5.5/
 * §14.5.6) — **the single validator every authoring mode calls.** Text mode,
 * Design mode, and the Studio wizard's Review step all ultimately compose an
 * `AgentDefinitionArtifact` and call `createAgentDefinitionVersion`
 * (`application/agent-definition-service.ts`), which calls this function BEFORE
 * anything is persisted — there is exactly one code path that can turn a
 * candidate artifact into a saved `Draft` row, and this is the one place it is
 * validated. `studio-single-validator.test.ts` asserts this by spying on this
 * module's own export, not by inspecting call sites (a spy proves the SAME
 * function object is invoked, not merely an equivalent-looking one).
 *
 * Two independent checks, both fail-closed:
 *  1. Structural validation against `AgentDefinitionArtifactSchema` (unchanged
 *     from the pre-Phase-12 inline check this function replaces).
 *  2. FR-AGT-14's guardrail tightening-only invariant
 *     (`@nextbot/authz#assertTightensOnly`): the artifact's own declared
 *     `spec.maskingFloor`/`spec.trustLevel`/`spec.channelTypes`/
 *     `spec.knowledge.{refuseWhenUngrounded,minCitations}` — the lattice
 *     dimensions this artifact shape can actually author today — must never be
 *     LOOSER than the tenant floor (`tenant_scope_policy`, `@nextbot/authz`).
 *     A violation throws `GuardrailLoosenedError` (422, `GUARDRAIL_LOOSENED`),
 *     which blocks **saving as Draft** — this function runs before any DB
 *     write in `createAgentDefinitionVersion`, never merely at promotion time.
 */
export async function validateAgentDefinitionArtifact(ctx: TenantContext, artifact: unknown): Promise<AgentDefinitionArtifact> {
  if (!Value.Check(AgentDefinitionArtifactSchema, artifact)) {
    const errors = [...Value.Errors(AgentDefinitionArtifactSchema, artifact)].map((e) => `${e.path}: ${e.message}`);
    throw new Error(`Invalid agent definition artifact: ${errors.join("; ")}`);
  }
  const validated = artifact as AgentDefinitionArtifact;

  const tenantFloor = await getTenantScopePolicy(ctx);
  const proposed = deriveProposedScopeFromArtifact(validated);
  assertTightensOnly(tenantFloor, proposed);

  return validated;
}

/**
 * Maps the subset of `AgentDefinitionArtifact.spec` this artifact shape can
 * actually author onto a `ScopeDescriptor` for `assertTightensOnly`. A
 * dimension the artifact doesn't declare is left OMITTED (never defaulted to a
 * concrete value) — `assertTightensOnly` itself treats an omitted dimension as
 * `⊤` (LLD §14.2.1's E3), so an undeclared dimension can never trigger a false
 * "loosened" rejection.
 *
 * **Disclosed, deliberate narrowing**: `spec.toolPolicy.capabilityGroups` is NOT
 * mapped onto `ScopeDescriptor.capabilityGroupIds`/`toolIds` here — the artifact
 * authors capability groups/tools by NAME (`capability_group.name`, resolved to
 * real tenant ids only at the orchestration call site,
 * `resolveCapabilityGroupIdsByNames`), while the lattice's own `IdSet` dimensions
 * are typed `uuid`-format ids; casting one into the other here would be a lossy,
 * incorrect equivalence, not a real tightening check. Real per-tool allow/deny
 * enforcement already exists independently for capability groups
 * (`permission-resolver.ts`'s `capability_group_not_permitted` check,
 * client-feedback-batch) — this validator does not weaken or duplicate that.
 */
export function deriveProposedScopeFromArtifact(artifact: AgentDefinitionArtifact): ScopeDescriptor {
  const knowledge = artifact.spec.knowledge;
  return {
    origin: "AgentVersion",
    originId: `${artifact.metadata.name}@${artifact.metadata.version}`,
    originLabel: `${artifact.metadata.name} ${artifact.metadata.version}`,
    ...(artifact.spec.maskingFloor ? { maskingFloor: artifact.spec.maskingFloor } : {}),
    ...(artifact.spec.trustLevel ? { trustLevel: artifact.spec.trustLevel } : {}),
    ...(artifact.spec.channelTypes && artifact.spec.channelTypes.length > 0 ? { channelTypes: artifact.spec.channelTypes } : {}),
    ...(knowledge?.refuseWhenUngrounded !== undefined ? { refuseWhenUngrounded: knowledge.refuseWhenUngrounded } : {}),
    ...(knowledge?.minCitations !== undefined ? { minCitations: knowledge.minCitations } : {}),
  };
}
