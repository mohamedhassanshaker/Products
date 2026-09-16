/**
 * Agent version numbering.
 *
 * Nothing in the wireframe or `docs/api.md` states this rule explicitly — it is
 * reconstructed by cross-referencing three real constraints in
 * `prisma/sql/001_constraints.sql`: `TR_AgentVersions_publishedImmutable` never fires on a
 * row whose *old* status wasn't already `'Published'`; `CK_AgentVersions_publishedPaired`
 * is symmetric (`status='Published' <=> publishedAt NOT NULL`); `CK_Agents_
 * publishedHasVersion` is one-directional (`Agent.status='Published' => currentVersionId
 * NOT NULL`, never the reverse). Together these only hold consistently if a Published
 * `AgentVersion` never leaves `'Published'` once reached — a permanent historical
 * snapshot, matching every doc's "immutable" framing — which is the assumption this file's
 * two functions are built on. See `tasks/todo.md`'s B-3 review entry for the full
 * derivation, including why `Agent.status` is therefore a separate, reversible axis from
 * `AgentVersion.status`.
 */

export interface VersionNumber {
  readonly major: number;
  readonly minor: number;
}

/** `"v1.4"` — matches `AgentVersions.label`'s own computed-column format exactly. */
export function versionLabel(version: VersionNumber): string {
  return `v${version.major}.${version.minor}`;
}

/** Where a brand-new agent (or a clone) starts: a never-published draft. */
export const INITIAL_DRAFT_VERSION: VersionNumber = { major: 0, minor: 1 };

/**
 * The version number a Draft becomes when it is published for the first time.
 *
 * A draft still at major 0 — an agent, or a clone, that has never been published before —
 * graduates to v1.0. Draft numbering (0.x) and the public version line (1.x+) are
 * deliberately different ranges: B2's own seed data shows "Library Services Agent … v0.9
 * … Draft" sitting comfortably below v1.0 with no version of it ever published. A draft
 * forked off an already-published version (major >= 1, via `nextDraftVersion` below at
 * fork time) is already at the number it should keep once published — this function is a
 * no-op for it.
 */
export function publishedVersionNumber(draft: VersionNumber): VersionNumber {
  return draft.major === 0 ? { major: 1, minor: 0 } : draft;
}

/**
 * The version number a new Draft gets when forked off a Published version to make it
 * editable again (`TR_AgentVersions_publishedImmutable` forbids editing the Published row
 * directly). Always the next minor — a major bump is a deliberate narrative choice (the
 * wireframe's own "v2.0 Rebuilt on Graph RAG") this system has no signal to make on its
 * own, so it is not offered as an automatic mechanism in this wave.
 */
export function nextDraftVersion(currentPublished: VersionNumber): VersionNumber {
  return { major: currentPublished.major, minor: currentPublished.minor + 1 };
}
