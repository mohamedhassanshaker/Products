import type { ArtifactKind } from "./artifact-kind.js";

/**
 * ADR-0016 §2.1 — "Security-relevant paths — scope, tool grants, approval tiers,
 * PII/guardrail policy, model route pins, server-version pins — are tagged so the
 * review UI can surface them first." A change's path is security-relevant when it
 * starts with (or exactly equals) any of these prefixes for its artifact kind.
 *
 * A prefix may contain a single `[*]` segment to match ANY keyed-array element id at
 * that position (e.g. `spec.nodes[*].scope` matches `spec.nodes[step-1].scope`
 * regardless of which node id `step-1` is) — see `prefixMatches` below.
 */
const SECURITY_RELEVANT_PATH_PREFIXES: Record<ArtifactKind, string[]> = {
  AgentVersion: [
    "spec.toolPolicy", // tool grants / capability-group scope
    "spec.guardrails", // guardrail policy, escalation triggers
    "spec.modelRoute", // model route pin
    "spec.graphType", // execution engine — changes the trust boundary of what runs
  ],
  // Target Architecture Blueprint Phase 5 (BL-35, ADR-0015, LLD §14.5.2) — corrected
  // to the real, shipped `SkillArtifactSchema` field paths (flat, no `spec` wrapper):
  // `scope` carries every tool/capability-group/knowledge grant plus the optional
  // `autonomyCeiling`, so tagging that one top-level prefix covers every
  // security-relevant skill field per ADR-0016 §2.1's own definition.
  SkillVersion: ["scope"],
  // Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.1/§14.6.3) — corrected
  // to the real, shipped `WorkflowGraphSchema` field paths now that this kind's
  // artifact schema exists (`@nextbot/contracts`'s `workflows.ts`). Dropped the prior
  // placeholder `spec.toolTiering` (no such field in the shipped schema); added the
  // real pinned-reference fields — a change to WHICH tool/agent/skill/sub-workflow/
  // MCP-server-version a node calls is exactly as security-relevant as a scope
  // narrowing, per ADR-0016 §2.1's own "tool grants ... server-version pins" wording.
  WorkflowVersion: [
    "spec.nodes[*].scope",
    "spec.nodes[*].approvalTier",
    "spec.nodes[*].toolId",
    "spec.nodes[*].mcpServerVersionId",
    "spec.nodes[*].agentDefinitionVersionId",
    "spec.nodes[*].skillVersionId",
    "spec.nodes[*].workflowVersionId",
    "spec.runLimits",
  ],
  TeamVersion: ["spec.permissionIntersection", "spec.members[*].scope"],
  ModelRouteVersion: ["spec.chain", "spec.residency"],
};

/** Escapes every regex-special character in a literal string segment. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A prefix containing a `[*]` segment matches any keyed-array element at that
 * position (`spec.nodes[*]` matches `spec.nodes[step-1]`, `spec.nodes[step-1].scope`,
 * …) — never a literal asterisk. **Disclosed fix**: `TeamVersion`'s
 * `spec.members[*].scope` entry (Phase 14) predates this wildcard support and was a
 * silent no-op until now (a literal `path.startsWith("spec.members[*].scope")` can
 * never match a real member id) — this file's own `diffArtifact("TeamVersion", ...)`
 * path is not yet called from any production code (`teams`' own diff endpoint uses a
 * plain line diff, not this structural one — see that module's `admin-routes.ts`), so
 * fixing the matcher here changes no observed behavior, only makes the already-authored
 * intent actually work once/if that module wires up structural diffing.
 */
function prefixMatches(path: string, prefix: string): boolean {
  if (!prefix.includes("[*]")) {
    return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
  }
  const pattern = new RegExp(`^${escapeRegExp(prefix).replace(/\\\[\\\*\\\]/g, "\\[[^\\]]+\\]")}($|\\.|\\[)`);
  return pattern.test(path);
}

export function isSecurityRelevantPath(kind: ArtifactKind, path: string): boolean {
  return SECURITY_RELEVANT_PATH_PREFIXES[kind].some((prefix) => prefixMatches(path, prefix));
}
