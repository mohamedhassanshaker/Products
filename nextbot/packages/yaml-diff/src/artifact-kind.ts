/**
 * The five YAML artifact kinds ADR-0016/FR-AGT-19 names. Only `AgentVersion` has a
 * real, shipped artifact schema in this codebase today (`AgentDefinitionArtifactSchema`,
 * `packages/contracts/src/agent-platform.ts`) — the other four are the Blueprint's
 * later modules (Skills/Workflows/Teams/Model-Gateway-v2 routes, Phases 7–9 of
 * `docs/plans/target-architecture-blueprint-plan.md`). This engine is generic over any
 * parsed YAML document regardless of kind, so the other four kinds get real structural
 * diff for free the moment their artifact schemas exist — nothing here needs to change
 * when they land, only their entries in `keyed-array-config.ts` / `security-tags.ts`
 * need to be added.
 */
export type ArtifactKind = "AgentVersion" | "SkillVersion" | "WorkflowVersion" | "TeamVersion" | "ModelRouteVersion";
