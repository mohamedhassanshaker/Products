/**
 * Pure lifecycle-transition guards for B2's registry actions.
 *
 * Each function takes facts the caller has already fetched (this module holds no vendor
 * imports, architecture.md §4) and returns a discriminated result rather than throwing —
 * the application layer decides how a disallowed transition surfaces (a rejected Server
 * Action result, never a raw exception), matching `docs/api.md` §6.3's own error codes
 * (`agent.not_published`, `agent.version_is_current`, …) so the reason string is already
 * the wire vocabulary, not an internal one that needs translating twice.
 */

import type { AgentStatus } from "./agent.js";

export type LifecycleCheck<TReason extends string> =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: TReason };

/** B2's Unpublish action — only meaningful on a currently-Published agent. */
export function canUnpublish(status: AgentStatus): LifecycleCheck<"agent.not_published"> {
  if (status !== "Published") return { allowed: false, reason: "agent.not_published" };
  return { allowed: true };
}

/**
 * B2's Publish action, applied to whichever `AgentVersion` the wizard draft currently
 * points at. Defensive only — `get-or-create-wizard-draft.ts` never hands back an
 * already-Published version to edit, so this should never actually reject in practice; it
 * exists so a future bug in that invariant fails loudly here rather than tripping
 * `TR_AgentVersions_publishedImmutable` at the database with a less legible error.
 */
export function canPublish(versionStatus: AgentStatus): LifecycleCheck<"agent.already_published"> {
  if (versionStatus === "Published") return { allowed: false, reason: "agent.already_published" };
  return { allowed: true };
}

/** B2's Archive action — refused while the agent is bound to a Live channel (`docs/api.md` §6.3), matching the "archiving a live assistant must be a deliberate two-step" rule. */
export function canArchive(
  boundToLiveChannel: boolean,
): LifecycleCheck<"agent.bound_to_live_channel"> {
  if (boundToLiveChannel) return { allowed: false, reason: "agent.bound_to_live_channel" };
  return { allowed: true };
}

/** B2's Roll back action — refused only when the target is already the current version. */
export function canRollback(targetIsCurrent: boolean): LifecycleCheck<"agent.version_is_current"> {
  if (targetIsCurrent) return { allowed: false, reason: "agent.version_is_current" };
  return { allowed: true };
}
