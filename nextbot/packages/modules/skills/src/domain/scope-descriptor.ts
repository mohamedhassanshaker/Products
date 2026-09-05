import type { SkillArtifact } from "@nextbot/contracts";

/**
 * LLD §14.5.2 — `scope_json`: "`ScopeDescriptorSchema` with `origin='Skill'` — the
 * descriptor handed to §14.2's [permission-intersection] evaluator verbatim,
 * derived from the three arrays plus any authored `rwClasses`/`autonomyCeiling`/
 * `budget`." The evaluator itself is Phase 6 (BL-37) scope, not built yet — this
 * function only shapes the descriptor so it's ready to be handed to that evaluator
 * once it ships, matching this phase's brief ("the unit of composition Studio/
 * workflows/teams build on").
 *
 * Pure/I/O-free (the ids embedded here are already resolved by the caller — this
 * function never itself resolves a name to an id).
 */
export interface ScopeDescriptor {
  origin: "Skill";
  capabilityGroupIds: string[];
  toolIds: string[];
  knowledgeCollectionNames: string[];
  rwClasses: ("Read" | "Write")[];
  autonomyCeiling: string | null;
  budget: { maxCostUsdPerConversation?: string; maxLatencyMsP95?: number } | null;
}

export function buildScopeDescriptor(
  scope: SkillArtifact["scope"],
  resolved: { capabilityGroupIds: string[]; toolIds: string[] },
): ScopeDescriptor {
  return {
    origin: "Skill",
    capabilityGroupIds: resolved.capabilityGroupIds,
    toolIds: resolved.toolIds,
    knowledgeCollectionNames: scope.knowledge,
    rwClasses: scope.rwClasses ?? [],
    autonomyCeiling: scope.autonomyCeiling ?? null,
    budget: scope.budget ?? null,
  };
}
