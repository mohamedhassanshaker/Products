/**
 * The registry + version + history port — B2 and B3 steps 1-3/10.
 *
 * Shaped around use cases (`publishVersion`, `cloneAgent`, `rollbackToVersion`, …) rather
 * than generic CRUD, matching `RoleRepository.updatePermissions`'s own precedent: almost
 * every real operation here is a multi-row transaction (Agent + AgentVersion + four
 * binding tables + a history entry), so a generic `update()` would just push that
 * transaction assembly into every caller instead of the one adapter that can actually
 * express it as `$transaction([...])`.
 *
 * Deliberately excludes `Skill`/`McpServer`/`ApiConnector`/`ToolBinding`/`CircuitBreaker*` —
 * those belong to `modules/tools/`, a sibling feature module this one may not import
 * (`eslint.config.mjs`'s `boundaries/element-types`). The one documented exception is
 * `cloneAgent`, which must also copy `ToolBindings` rows to satisfy `docs/api.md` §4.4's
 * "one transaction" requirement — see the adapter implementation's own doc comment for
 * exactly how that is done without an import crossing the module boundary.
 */

import type { AgentStatus, ChannelKey, HistoryEntryKind, Tone } from "../domain/agent.js";
import type { VersionNumber } from "../domain/version.js";

export interface AgentRegistryRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly ownerTenantId: string;
  readonly status: AgentStatus;
  readonly currentVersionId: string | null;
  readonly currentVersionLabel: string | null;
  readonly enabledChannelKeys: readonly ChannelKey[];
  /** From `AgentUsageDaily`, the most recent day on or before "now" that has a row. `null` when no usage row exists yet (e.g. a never-published Draft). */
  readonly usagePerDay: number | null;
}

export interface AgentDetail {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly ownerTenantId: string;
  readonly status: AgentStatus;
  readonly currentVersionId: string | null;
  readonly clonedFromAgentId: string | null;
  readonly createdAt: Date;
}

export interface AgentVersionDetail {
  readonly id: string;
  readonly agentId: string;
  readonly version: VersionNumber;
  readonly label: string;
  readonly status: AgentStatus;
  readonly isCurrent: boolean;
  readonly systemPrompt: string;
  readonly tone: Tone;
  readonly primaryModel: string;
  readonly fallbackModel: string | null;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly changeSummary: string | null;
  readonly publishedAt: Date | null;
  readonly clonedFromVersionId: string | null;
}

export interface AgentVersionSummary {
  readonly id: string;
  readonly version: VersionNumber;
  readonly label: string;
  readonly status: AgentStatus;
  readonly isCurrent: boolean;
  readonly changeSummary: string | null;
  readonly publishedAt: Date | null;
}

export interface AgentVersionHistoryEntryRow {
  readonly id: string;
  readonly agentVersionId: string | null;
  readonly kind: HistoryEntryKind;
  readonly note: string;
  readonly fromVersionId: string | null;
  readonly actorStaffUserId: string;
  readonly occurredAt: Date;
}

export interface NewAgentInput {
  readonly name: string;
  readonly description: string | null;
  readonly ownerTenantId: string;
  readonly createdByStaffUserId: string;
  readonly now: Date;
}

export interface UpdateVersionConfigInput {
  readonly agentVersionId: string;
  readonly systemPrompt?: string;
  readonly tone?: Tone;
  readonly primaryModel?: string;
  readonly fallbackModel?: string | null;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly now: Date;
}

/**
 * `reason: "immutable"` is `TR_AgentVersions_publishedImmutable` (error 51110) translated —
 * this should never actually happen given `get-or-create-wizard-draft.ts` only ever hands
 * back a Draft version to edit, but it is modelled rather than left to surface as a raw SQL
 * exception if that invariant is ever violated by a future bug.
 */
export type UpdateVersionConfigResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "immutable"; readonly message: string };

export interface AgentRepository {
  listForRegistry(filter?: {
    readonly status?: AgentStatus;
    readonly q?: string;
  }): Promise<readonly AgentRegistryRow[]>;

  getAgentDetail(agentId: string): Promise<AgentDetail | null>;
  findAgentBySlug(slug: string): Promise<AgentDetail | null>;
  getVersion(agentVersionId: string): Promise<AgentVersionDetail | null>;
  listVersions(agentId: string): Promise<readonly AgentVersionSummary[]>;
  listVersionHistory(agentId: string): Promise<readonly AgentVersionHistoryEntryRow[]>;

  /** Creates the `Agents` row + its v0.1 Draft `AgentVersions` row + a `'Created'` history entry, in one transaction. `slug` is derived from `name`, disambiguated against existing live slugs, inside the adapter. */
  createAgent(input: NewAgentInput): Promise<{ agentId: string; agentVersionId: string }>;

  /** Deep-copies Agent + its current version's scalar config + the four per-version binding tables + `ToolBindings` into a new Agent at v0.1 Draft, one transaction. Writes the `'Cloned from …'` history entry. */
  cloneAgent(input: {
    readonly sourceAgentId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ agentId: string; agentVersionId: string; sourceLabel: string }>;

  /**
   * Forks a new Draft version off the agent's current version (same deep-copy shape as
   * `cloneAgent`, minus the new-Agent row), so an already-Published agent becomes editable
   * again without touching the immutable row directly. Returns the existing current
   * version's id, unchanged, if it is *already* a Draft — there is nothing to fork.
   */
  forkOrReuseDraftVersion(input: {
    readonly agentId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ agentVersionId: string; wasForked: boolean }>;

  updateVersionConfig(input: UpdateVersionConfigInput): Promise<UpdateVersionConfigResult>;

  /** Publishes a Draft version: sets it Published (permanently) + current, un-currents whichever version was current before, flips `Agent.status` to Published, writes history. */
  publishVersion(input: {
    readonly agentVersionId: string;
    readonly changeSummary: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ ok: true; label: string } | { ok: false; reason: "agent.already_published" }>;

  /** `Agent.status: Published -> Draft` only — never touches `AgentVersion.status` (see `domain/version.ts`'s module comment for why). */
  unpublishAgent(input: {
    readonly agentId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ ok: true } | { ok: false; reason: "agent.not_published" }>;

  archiveAgent(input: {
    readonly agentId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ ok: true } | { ok: false; reason: "agent.bound_to_live_channel" }>;

  rollbackToVersion(input: {
    readonly agentId: string;
    readonly targetVersionId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ ok: true } | { ok: false; reason: "agent.version_is_current" }>;

  editAgent(input: {
    readonly agentId: string;
    readonly name?: string;
    readonly description?: string | null;
  }): Promise<void>;

  /** The `canArchive` fact: whether `agentId` is the `boundAgentId` of any `Channel` row with `state = 'Live'`. */
  isBoundToLiveChannel(agentId: string): Promise<boolean>;

  /** Registry usage column — most recent `AgentUsageDaily.conversationCount` on or before `asOf`. */
  getLatestUsage(agentId: string, asOf: Date): Promise<number | null>;
}
