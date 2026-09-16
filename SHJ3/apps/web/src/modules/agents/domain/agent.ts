/**
 * Enums and small value types for the agent registry and wizard.
 *
 * Transcribed directly from the real CHECK constraints in `prisma/sql/001_constraints.sql`
 * and the matching Prisma doc comments (confirmed by dedicated research before writing
 * this file, not guessed — see `tasks/todo.md`'s B-3 review). Pure domain: no vendor
 * imports (architecture.md §4), so this file has no idea a database exists.
 */

/** `CK_Agents_status`. The registry-level lifecycle B2's Publish/Unpublish/Archive actions
 * drive — independent of `AgentVersionStatus` below; see `version.ts`'s module comment for
 * why the two axes are kept separate despite sharing the same three literal values. */
export const AGENT_STATUSES = ["Draft", "Published", "Archived"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export function isAgentStatus(value: string): value is AgentStatus {
  return (AGENT_STATUSES as readonly string[]).includes(value);
}

/** `CK_AgentVersions_status`. Once a version reaches `Published` it never leaves that
 * state (see `version.ts`) — `Archived` at the version level applies only to an abandoned
 * Draft that is discarded without ever being published. */
export const AGENT_VERSION_STATUSES = ["Draft", "Published", "Archived"] as const;
export type AgentVersionStatus = (typeof AGENT_VERSION_STATUSES)[number];
export function isAgentVersionStatus(value: string): value is AgentVersionStatus {
  return (AGENT_VERSION_STATUSES as readonly string[]).includes(value);
}

/** `CK_AgentVersions_tone` — B3 step 2's three tone pills. */
export const TONES = ["Helpful", "Formal", "Concise"] as const;
export type Tone = (typeof TONES)[number];
export function isTone(value: string): value is Tone {
  return (TONES as readonly string[]).includes(value);
}

/**
 * `Channels.key`'s own documented vocabulary (`schema.prisma`), reused rather than
 * reinvented for `AgentChannelBinding.channelKey` — which carries no CHECK constraint of
 * its own (confirmed absent from `001_constraints.sql`) but must still agree with the one
 * real channel registry this platform has, or a future join between the two would
 * silently find nothing (the exact drift class `tasks/lessons.md` warns about). B3 step 8
 * exposes only three of these four (no Mobile App toggle in the wireframe); the domain
 * type keeps all four for correctness.
 */
export const CHANNEL_KEYS = ["WebWidget", "WhatsApp", "MobileApp", "KioskIvr"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];
export function isChannelKey(value: string): value is ChannelKey {
  return (CHANNEL_KEYS as readonly string[]).includes(value);
}

/** The three channel toggles B3 step 8 actually renders (wireframe: Web widget, WhatsApp, Kiosk/IVR). */
export const WIZARD_CHANNEL_KEYS: readonly ChannelKey[] = ["WebWidget", "WhatsApp", "KioskIvr"];

/** `CK_AgentVersionHistoryEntries_kind` — append-only history entry kinds. */
export const HISTORY_ENTRY_KINDS = [
  "Created",
  "Cloned",
  "Published",
  "Unpublished",
  "RolledBack",
  "Promoted",
  "Archived",
] as const;
export type HistoryEntryKind = (typeof HISTORY_ENTRY_KINDS)[number];

/**
 * B3's 10 steps, in wizard order. Step 4 ("Skills & tools") is rendered by composing the
 * `tools` module at the app/route layer — see the module-boundary note in `tasks/todo.md`
 * — so nothing in this domain module knows anything about skills, MCP servers or
 * connectors.
 */
export const WIZARD_STEP_IDS = [
  "identity",
  "instructions",
  "model",
  "tools",
  "knowledge",
  "flows",
  "guardrails",
  "channels",
  "test",
  "publish",
] as const;
export type WizardStepId = (typeof WIZARD_STEP_IDS)[number];
export function isWizardStepId(value: string): value is WizardStepId {
  return (WIZARD_STEP_IDS as readonly string[]).includes(value);
}

/** 1-based step number, matching `AgentWizardDrafts.lastStep`'s own `CHECK (lastStep BETWEEN 1 AND 10)`. */
export function wizardStepNumber(stepId: WizardStepId): number {
  return WIZARD_STEP_IDS.indexOf(stepId) + 1;
}
