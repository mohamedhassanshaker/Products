/**
 * Flow version numbering — the same major.minor shape and the same "a draft starts at 0.x"
 * convention `modules/agents/domain/version.ts` already established for `AgentVersion`
 * (`tasks/lessons.md`'s "grep the real schema/sibling before inventing a new shape" lesson:
 * `FlowVersions.major`/`.minor` are the identical column pair). Not imported from
 * `modules/agents/` — a feature module may not depend on a sibling feature
 * (`eslint.config.mjs`'s `boundaries/element-types`) — so this is a deliberate, small,
 * parallel definition rather than a forced cross-module import for four lines of logic.
 */

export interface FlowVersionNumber {
  readonly major: number;
  readonly minor: number;
}

/** Where a brand-new flow starts: a never-published draft. */
export const INITIAL_FLOW_DRAFT_VERSION: FlowVersionNumber = { major: 0, minor: 1 };

export function flowVersionLabel(version: FlowVersionNumber): string {
  return `v${version.major}.${version.minor}`;
}

/** The version a new draft gets when forked off a Published version to make it editable again (`TR_FlowVersions_publishedImmutable` forbids editing the Published row directly). */
export function nextFlowDraftVersion(currentPublished: FlowVersionNumber): FlowVersionNumber {
  return { major: currentPublished.major, minor: currentPublished.minor + 1 };
}

/**
 * The version number a Draft becomes when it is published for the first time — mirrors
 * `modules/agents/domain/version.ts`'s `publishedVersionNumber` exactly (a draft still at
 * major 0 graduates to v1.0; a draft already forked off a published version, via
 * `nextFlowDraftVersion` above, is already at the number it should keep, so this is a no-op
 * for it). Not imported from `modules/agents/` for the same module-boundary reason this
 * file's own module comment already gives for `FlowVersionNumber` itself.
 */
export function publishedFlowVersionNumber(draft: FlowVersionNumber): FlowVersionNumber {
  return draft.major === 0 ? { major: 1, minor: 0 } : draft;
}

export type FlowVersionLifecycleCheck<TReason extends string> =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: TReason };

/**
 * The Publish action's own lifecycle guard — mirrors `modules/agents/domain/agent-
 * lifecycle.ts`'s `canPublish`. Defensive only: `GetOrCreateDraftFlowVersion` never hands
 * back an already-Published version to edit, so this should never actually reject in
 * practice — it exists so a future bug in that invariant fails loudly here rather than
 * tripping `TR_FlowVersions_publishedImmutable` at the database with a less legible error.
 */
export function canPublishFlowVersion(
  status: "Draft" | "Published" | "Archived",
): FlowVersionLifecycleCheck<"flows.already_published"> {
  if (status === "Published") return { allowed: false, reason: "flows.already_published" };
  return { allowed: true };
}
