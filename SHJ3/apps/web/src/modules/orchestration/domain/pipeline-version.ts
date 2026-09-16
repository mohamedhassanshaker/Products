/**
 * Pipeline version numbering — a direct structural mirror of `modules/agents/domain/
 * version.ts` (and `modules/flows/domain/flow-version.ts`, which already makes the
 * identical choice for the identical reason): `modules/orchestration` cannot import
 * `modules/agents` directly (`eslint.config.mjs`'s `boundaries/element-types` forbids one
 * feature module importing a sibling — both are listed `FEATURE_MODULES`), so this is a
 * deliberate parallel definition, not a re-derivation. The numbering RULE is the one this
 * codebase already established for every `Draft -> Published` version lineage; only the
 * import path differs.
 */

export interface PipelineVersionNumber {
  readonly major: number;
  readonly minor: number;
}

/** `"v1.2"` — matches `PipelineVersions.label`'s own computed-column format exactly, the
 *  same convention `AgentVersions.label`/`FlowVersions.label` already use. */
export function pipelineVersionLabel(version: PipelineVersionNumber): string {
  return `v${version.major}.${version.minor}`;
}

/** Where a brand-new pipeline design starts: a never-published draft. */
export const INITIAL_PIPELINE_DRAFT_VERSION: PipelineVersionNumber = { major: 0, minor: 1 };

/** The version number a Draft becomes when published for the first time. A draft still at
 *  major 0 graduates to v1.0; a draft forked off an already-published version (major >= 1,
 *  via `nextPipelineDraftVersion` at fork time) is already at the number it should keep
 *  once published, so this is a no-op for it. */
export function publishedPipelineVersionNumber(draft: PipelineVersionNumber): PipelineVersionNumber {
  return draft.major === 0 ? { major: 1, minor: 0 } : draft;
}

/** The version number a new Draft gets when forked off a Published version to make it
 *  editable again (a Published pipeline version is immutable, same as `AgentVersion`/
 *  `FlowVersion`). Always the next minor — a major bump is a deliberate narrative choice
 *  this system has no signal to make on its own, so it isn't offered automatically. */
export function nextPipelineDraftVersion(currentPublished: PipelineVersionNumber): PipelineVersionNumber {
  return { major: currentPublished.major, minor: currentPublished.minor + 1 };
}
