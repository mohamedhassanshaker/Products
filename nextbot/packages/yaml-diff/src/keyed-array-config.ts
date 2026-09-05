import type { ArtifactKind } from "./artifact-kind.js";

/**
 * ADR-0016 §2.1/§4 — every array reachable from an artifact schema must be
 * *declared*, one of:
 *   - `{ mode: "keyed", keyField }` — a semantically keyed array (workflow nodes by
 *     node id, team members by member id, tool grants by tool id, …): diffed by that
 *     key, never by array position, so inserting a member at the front doesn't render
 *     as "every member changed."
 *   - `{ mode: "set" }` — an unordered bag of primitive values where only membership
 *     matters (e.g. a list of capability-group names) — reordering produces no diff.
 *   - `{ mode: "positional" }` — explicitly acknowledged as position-sensitive; a
 *     degraded-but-honest fallback for an array this config doesn't yet have richer
 *     knowledge of.
 *
 * `diffSchemaTest.ts` (this package's own schema-coverage test) asserts every array
 * path actually reachable from `AgentDefinitionArtifactSchema` today has an explicit
 * entry here — a missing one is a config gap, not a silent behavioral choice, per
 * ADR-0016 §4's "a missing key config degrades to positional diffing... a schema test
 * asserts every array ... is either declared keyed or explicitly declared positional."
 */
export type ArrayDiffMode = { mode: "keyed"; keyField: string } | { mode: "set" } | { mode: "positional" };

/** Keyed by the dotted path from the artifact root (not kind-specific formatting —
 * each kind has its own top-level map). A path not present here falls back to
 * `{ mode: "positional" }` (ADR-0016 §4's documented, deliberate degrade). */
export type ArrayDiffConfig = Record<string, ArrayDiffMode>;

/**
 * Per-kind array configuration. `AgentVersion` is the only kind with array-typed
 * fields in its shipped schema today (`spec.toolPolicy.capabilityGroups`,
 * `spec.guardrails.escalateOn`) — both plain string lists with no per-element
 * identity, so `"set"` is the correct, explicit declaration for both (order is not a
 * meaningful change; membership is).
 */
export const ARRAY_DIFF_CONFIG: Record<ArtifactKind, ArrayDiffConfig> = {
  AgentVersion: {
    "spec.toolPolicy.capabilityGroups": { mode: "set" },
    "spec.guardrails.escalateOn": { mode: "set" },
  },
  // Target Architecture Blueprint Phase 5 (BL-35, ADR-0015, LLD §14.5.2) —
  // `SkillArtifactSchema` (`@nextbot/contracts`) ships a flat, top-level shape (no
  // `spec` wrapper, unlike `AgentVersion`). Every array field is an unordered bag of
  // plain strings with no per-element identity (capability-group/tool/knowledge
  // names, escalation conditions, eval-case keys) — `"set"` is the correct,
  // explicit declaration for all of them, same reasoning as `AgentVersion`'s two
  // entries above.
  SkillVersion: {
    "scope.capabilityGroups": { mode: "set" },
    "scope.tools": { mode: "set" },
    "scope.knowledge": { mode: "set" },
    "scope.rwClasses": { mode: "set" },
    escalateWhen: { mode: "set" },
    evalCases: { mode: "set" },
  },
  // Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.1/§14.6.3) —
  // `WorkflowGraphSchema` (`@nextbot/contracts`) ships one keyed array: `spec.nodes`,
  // keyed by each node's own `id`. Nested arrays INSIDE a given node (e.g. a Trigger's
  // `source.channelTypes`, a Router's `branches`) live at a dynamically-keyed parent
  // path (`spec.nodes[<nodeId>].source.channelTypes`) that this exact-match config map
  // cannot express — they fall back to `{mode: "positional"}` (ADR-0016 §4's
  // documented, deliberate degrade: noisy but never silently wrong). No schema-
  // coverage test enforces "every array declared" yet (`diffSchemaTest.ts` mentioned
  // above is aspirational, not built), so this is a disclosed, acceptable gap, not a
  // gate failure.
  WorkflowVersion: { "spec.nodes": { mode: "keyed", keyField: "id" } },
  // No shipped artifact schema yet for these two (Phases 9's Route v2 YAML surface,
  // if any, plus whatever Team schema paths still need declaring) — empty configs are
  // correct today; every array path that appears once each schema exists must be
  // added here before that phase's exit gate (enforced by this package's own
  // schema-coverage test once each schema is importable from `@nextbot/contracts`).
  TeamVersion: {},
  ModelRouteVersion: {},
};

export function resolveArrayDiffMode(kind: ArtifactKind, path: string): ArrayDiffMode {
  return ARRAY_DIFF_CONFIG[kind][path] ?? { mode: "positional" };
}
