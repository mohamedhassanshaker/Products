// PUBLIC API for "@nextbot/yaml-diff" (ADR-0016). Pure, I/O-free leaf package —
// importable from any module or app without a dependency-cruiser/eslint-boundaries
// violation (it lives in `packages/*`, not `packages/modules/*`).
import yaml from "js-yaml";
import type { ArtifactKind } from "./artifact-kind.js";
import type { ChangeSet } from "./change-set.js";
import { diffParsedArtifact } from "./structural-diff.js";

export type { ArtifactKind } from "./artifact-kind.js";
export type { Change, ChangeOp, ChangeSet } from "./change-set.js";
export { ARRAY_DIFF_CONFIG, resolveArrayDiffMode, type ArrayDiffMode, type ArrayDiffConfig } from "./keyed-array-config.js";
export { isSecurityRelevantPath } from "./security-tags.js";
export { diffParsedArtifact, diffKeyedArray, diffSetArray } from "./structural-diff.js";

/**
 * ADR-0016 §2.1 — the Git-independent structural-diff baseline: `diffArtifact(kind,
 * leftYaml, rightYaml) -> ChangeSet`. Computed directly from the two stored YAML
 * documents — no Git connection, no commit, no network call — so it works
 * unconditionally for every version of every YAML artifact, including the majority of
 * agent versions today that have no `git_commit_sha` at all (ADR-0009's Git-optional
 * authoring path).
 *
 * Deliberately narrow error surface: a YAML parse failure on either input propagates
 * as-is (a malformed stored artifact is a genuine data problem the caller should
 * surface, not one this function should paper over by treating it as "everything
 * changed").
 */
export function diffArtifact(kind: ArtifactKind, leftYaml: string, rightYaml: string): ChangeSet {
  const left = yaml.load(leftYaml);
  const right = yaml.load(rightYaml);
  return diffParsedArtifact(kind, left, right);
}
