/**
 * In-memory implementations of every `agents` port.
 *
 * Mirrors `modules/iam/testing/fakes.ts`'s own two rules for why these exist and what they
 * must do:
 *
 *  - **Ids are generated, never accepted.** Every `create`-shaped method mints its own,
 *    deterministic (`agent-1`, `agentversion-1`, `draft-1`, ...) so assertions can name them.
 *  - **Failures are reachable.** `canPublish`/`canUnpublish`/`canArchive`/`canRollback`'s
 *    rejection branches, and `PolicyOverride`'s locked-policy branch, are all real,
 *    triggerable paths here — not just happy-path stubs — because that is where B2/B3's
 *    authorization-adjacent decisions actually live.
 *
 * `FakeAgentRepository` tracks realistic in-memory state (agents, their versions, which
 * version is current, publish/fork lineage) rather than stubbing return values, because
 * `GetOrCreateWizardDraft`'s fork-vs-reuse branch and `PublishAgentVersion`'s defense-in-depth
 * guard both depend on that state actually being consistent across calls within one test —
 * a fake that only returns canned values could not exercise either.
 *
 * Not a `.test.ts` file: it is the module's test support, imported by tests, and subject to
 * the same lint rules as production code (module-boundary + no-vendor-imports both apply).
 */

import {
  type AgentStatus,
  type ChannelKey,
  type HistoryEntryKind,
  type Tone,
} from "../domain/agent.js";
import {
  INITIAL_DRAFT_VERSION,
  nextDraftVersion,
  publishedVersionNumber,
  versionLabel,
} from "../domain/version.js";
import type {
  AgentDetail,
  AgentRegistryRow,
  AgentRepository,
  AgentVersionDetail,
  AgentVersionHistoryEntryRow,
  AgentVersionSummary,
  NewAgentInput,
  UpdateVersionConfigInput,
  UpdateVersionConfigResult,
} from "../ports/agent-repository.js";
import type { WizardDraft, WizardDraftRepository } from "../ports/wizard-draft-repository.js";
import type {
  AgentBindingsRepository,
  ChannelBindingRow,
  FlowBindingRow,
  KnowledgeBindingRow,
  LocaleBindingRow,
} from "../ports/agent-bindings-repository.js";
import type {
  AgentPolicyOverrideRow,
  GuardrailPolicyRow,
  PolicyOverrideRepository,
} from "../ports/policy-override-repository.js";

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent"
  );
}

// ------------------------------------------------------------------------ AgentRepository ---

interface FakeAgent {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  ownerTenantId: string;
  status: AgentStatus;
  currentVersionId: string | null;
  clonedFromAgentId: string | null;
  createdAt: Date;
}

interface FakeVersion {
  id: string;
  agentId: string;
  major: number;
  minor: number;
  status: AgentStatus;
  isCurrent: boolean;
  systemPrompt: string;
  tone: Tone;
  primaryModel: string;
  fallbackModel: string | null;
  temperature: number;
  maxOutputTokens: number;
  changeSummary: string | null;
  publishedAt: Date | null;
  clonedFromVersionId: string | null;
}

function toAgentDetail(agent: FakeAgent): AgentDetail {
  return {
    id: agent.id,
    name: agent.name,
    slug: agent.slug,
    description: agent.description,
    ownerTenantId: agent.ownerTenantId,
    status: agent.status,
    currentVersionId: agent.currentVersionId,
    clonedFromAgentId: agent.clonedFromAgentId,
    createdAt: agent.createdAt,
  };
}

function toVersionDetail(version: FakeVersion): AgentVersionDetail {
  const number = { major: version.major, minor: version.minor };
  return {
    id: version.id,
    agentId: version.agentId,
    version: number,
    label: versionLabel(number),
    status: version.status,
    isCurrent: version.isCurrent,
    systemPrompt: version.systemPrompt,
    tone: version.tone,
    primaryModel: version.primaryModel,
    fallbackModel: version.fallbackModel,
    temperature: version.temperature,
    maxOutputTokens: version.maxOutputTokens,
    changeSummary: version.changeSummary,
    publishedAt: version.publishedAt,
    clonedFromVersionId: version.clonedFromVersionId,
  };
}

const DEFAULT_CONFIG = {
  systemPrompt: "",
  tone: "Helpful" as Tone,
  primaryModel: "claude-sonnet-5",
  fallbackModel: null as string | null,
  temperature: 0.7,
  maxOutputTokens: 1024,
};

export interface SeedAgentInput {
  readonly id?: string;
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly ownerTenantId?: string;
  /** `Agent.status` — independent of the seeded version's own status (`domain/version.ts`'s module comment). Defaults to the version's status when omitted. */
  readonly status?: AgentStatus;
  readonly version?: {
    readonly id?: string;
    readonly major?: number;
    readonly minor?: number;
    readonly status?: AgentStatus;
    readonly changeSummary?: string | null;
    readonly publishedAt?: Date | null;
  };
}

export interface SeedVersionInput {
  readonly id?: string;
  readonly agentId: string;
  readonly major: number;
  readonly minor: number;
  readonly status?: AgentStatus;
  readonly isCurrent?: boolean;
  readonly changeSummary?: string | null;
  readonly publishedAt?: Date | null;
}

/**
 * `AgentVersionHistoryEntryRow` (the port's own DTO) deliberately carries no `agentId` —
 * `listVersionHistory(agentId)` already scopes by it as a query parameter, so each row would
 * otherwise repeat it redundantly. This fake still needs to track which agent a row belongs
 * to internally (to filter by it), hence this local, storage-only superset type — never
 * exposed as-is to a caller expecting the port's own narrower shape for a single row.
 */
type FakeHistoryEntry = AgentVersionHistoryEntryRow & { readonly agentId: string };

export class FakeAgentRepository implements AgentRepository {
  private readonly agents = new Map<string, FakeAgent>();
  private readonly versions = new Map<string, FakeVersion>();
  private readonly history: FakeHistoryEntry[] = [];
  private readonly liveChannelBoundAgents = new Set<string>();
  private readonly usageByAgent = new Map<string, number>();
  private readonly registryChannelKeysByAgent = new Map<string, readonly ChannelKey[]>();
  private counter = 0;
  private historyCounter = 0;

  /** Every call, in order — asserted by `create-agent.test.ts`. */
  readonly createAgentCalls: NewAgentInput[] = [];
  readonly cloneAgentCalls: { sourceAgentId: string; actorStaffUserId: string; now: Date }[] = [];
  readonly forkOrReuseDraftVersionCalls: {
    agentId: string;
    actorStaffUserId: string;
    now: Date;
  }[] = [];
  readonly publishVersionCalls: {
    agentVersionId: string;
    changeSummary: string | null;
    actorStaffUserId: string;
    now: Date;
  }[] = [];
  readonly unpublishAgentCalls: { agentId: string; actorStaffUserId: string; now: Date }[] = [];
  readonly archiveAgentCalls: { agentId: string; actorStaffUserId: string; now: Date }[] = [];
  readonly rollbackToVersionCalls: {
    agentId: string;
    targetVersionId: string;
    actorStaffUserId: string;
    now: Date;
  }[] = [];
  readonly editAgentCalls: { agentId: string; name?: string; description?: string | null }[] = [];

  private pushHistory(entry: Omit<FakeHistoryEntry, "id">): void {
    this.historyCounter += 1;
    this.history.push({ id: `history-${this.historyCounter}`, ...entry });
  }

  /** Test setup: seed one agent + its (only, current) version directly, bypassing `createAgent`. */
  seedAgent(input: SeedAgentInput = {}): { agentId: string; agentVersionId: string } {
    this.counter += 1;
    const agentId = input.id ?? `agent-${this.counter}`;
    const agentVersionId = input.version?.id ?? `agentversion-${this.counter}`;
    const name = input.name ?? "Test Agent";
    const versionStatus = input.version?.status ?? input.status ?? "Draft";

    this.agents.set(agentId, {
      id: agentId,
      name,
      slug: input.slug ?? slugify(name),
      description: input.description ?? null,
      ownerTenantId: input.ownerTenantId ?? "tenant-1",
      status: input.status ?? versionStatus,
      currentVersionId: agentVersionId,
      clonedFromAgentId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    this.versions.set(agentVersionId, {
      id: agentVersionId,
      agentId,
      major: input.version?.major ?? 0,
      minor: input.version?.minor ?? 1,
      status: versionStatus,
      isCurrent: true,
      ...DEFAULT_CONFIG,
      changeSummary: input.version?.changeSummary ?? null,
      publishedAt: input.version?.publishedAt ?? null,
      clonedFromVersionId: null,
    });
    return { agentId, agentVersionId };
  }

  /** Test setup: add another version onto an already-seeded agent (e.g. a non-current historical version for rollback tests). */
  seedVersion(input: SeedVersionInput): string {
    this.counter += 1;
    const id = input.id ?? `agentversion-${this.counter}`;
    const isCurrent = input.isCurrent ?? false;
    if (isCurrent) {
      for (const version of this.versions.values()) {
        if (version.agentId === input.agentId) version.isCurrent = false;
      }
    }
    this.versions.set(id, {
      id,
      agentId: input.agentId,
      major: input.major,
      minor: input.minor,
      status: input.status ?? "Published",
      isCurrent,
      ...DEFAULT_CONFIG,
      changeSummary: input.changeSummary ?? null,
      publishedAt: input.publishedAt ?? null,
      clonedFromVersionId: null,
    });
    if (isCurrent) {
      const agent = this.agents.get(input.agentId);
      if (agent) agent.currentVersionId = id;
    }
    return id;
  }

  /** Test setup: append a history row directly (e.g. to test `GetVersionHistory` without replaying every use case that would have produced it). */
  seedHistoryEntry(entry: {
    readonly agentId: string;
    readonly agentVersionId: string | null;
    readonly kind: HistoryEntryKind;
    readonly note: string;
    readonly fromVersionId?: string | null;
    readonly actorStaffUserId: string;
    readonly occurredAt: Date;
  }): void {
    this.pushHistory({
      agentId: entry.agentId,
      agentVersionId: entry.agentVersionId,
      kind: entry.kind,
      note: entry.note,
      fromVersionId: entry.fromVersionId ?? null,
      actorStaffUserId: entry.actorStaffUserId,
      occurredAt: entry.occurredAt,
    });
  }

  setBoundToLiveChannel(agentId: string, bound: boolean): void {
    if (bound) this.liveChannelBoundAgents.add(agentId);
    else this.liveChannelBoundAgents.delete(agentId);
  }

  setUsage(agentId: string, conversationsPerDay: number): void {
    this.usageByAgent.set(agentId, conversationsPerDay);
  }

  /** Test setup only: `listForRegistry`'s `enabledChannelKeys` in the real adapter is derived from the current version's channel bindings (a separate port); this fake keys it directly by agent since no specified use case test needs multi-version binding realism here. */
  setRegistryChannelKeys(agentId: string, keys: readonly ChannelKey[]): void {
    this.registryChannelKeysByAgent.set(agentId, keys);
  }

  async listForRegistry(filter?: {
    readonly status?: AgentStatus;
    readonly q?: string;
  }): Promise<readonly AgentRegistryRow[]> {
    const q = filter?.q?.toLowerCase();
    return [...this.agents.values()]
      .filter((agent) => (filter?.status ? agent.status === filter.status : true))
      .filter((agent) => (q ? agent.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((agent) => {
        const version = agent.currentVersionId
          ? this.versions.get(agent.currentVersionId)
          : undefined;
        return {
          id: agent.id,
          name: agent.name,
          slug: agent.slug,
          ownerTenantId: agent.ownerTenantId,
          status: agent.status,
          currentVersionId: agent.currentVersionId,
          currentVersionLabel: version
            ? versionLabel({ major: version.major, minor: version.minor })
            : null,
          enabledChannelKeys: this.registryChannelKeysByAgent.get(agent.id) ?? [],
          usagePerDay: this.usageByAgent.get(agent.id) ?? null,
        };
      });
  }

  async getAgentDetail(agentId: string): Promise<AgentDetail | null> {
    const agent = this.agents.get(agentId);
    return agent ? toAgentDetail(agent) : null;
  }

  async findAgentBySlug(slug: string): Promise<AgentDetail | null> {
    const agent = [...this.agents.values()].find((a) => a.slug === slug);
    return agent ? toAgentDetail(agent) : null;
  }

  async getVersion(agentVersionId: string): Promise<AgentVersionDetail | null> {
    const version = this.versions.get(agentVersionId);
    return version ? toVersionDetail(version) : null;
  }

  async listVersions(agentId: string): Promise<readonly AgentVersionSummary[]> {
    return [...this.versions.values()]
      .filter((v) => v.agentId === agentId)
      .sort((a, b) => b.major - a.major || b.minor - a.minor)
      .map((v) => {
        const number = { major: v.major, minor: v.minor };
        return {
          id: v.id,
          version: number,
          label: versionLabel(number),
          status: v.status,
          isCurrent: v.isCurrent,
          changeSummary: v.changeSummary,
          publishedAt: v.publishedAt,
        };
      });
  }

  async listVersionHistory(agentId: string): Promise<readonly AgentVersionHistoryEntryRow[]> {
    return this.history
      .filter((h) => h.agentId === agentId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }

  async createAgent(input: NewAgentInput): Promise<{ agentId: string; agentVersionId: string }> {
    this.createAgentCalls.push(input);
    this.counter += 1;
    const agentId = `agent-${this.counter}`;
    const agentVersionId = `agentversion-${this.counter}`;

    this.agents.set(agentId, {
      id: agentId,
      name: input.name,
      slug: slugify(input.name),
      description: input.description,
      ownerTenantId: input.ownerTenantId,
      status: "Draft",
      currentVersionId: agentVersionId,
      clonedFromAgentId: null,
      createdAt: input.now,
    });
    this.versions.set(agentVersionId, {
      id: agentVersionId,
      agentId,
      major: INITIAL_DRAFT_VERSION.major,
      minor: INITIAL_DRAFT_VERSION.minor,
      status: "Draft",
      isCurrent: true,
      ...DEFAULT_CONFIG,
      changeSummary: null,
      publishedAt: null,
      clonedFromVersionId: null,
    });
    this.pushHistory({
      agentId,
      agentVersionId,
      kind: "Created",
      note: `Created "${input.name}" as a Draft.`,
      fromVersionId: null,
      actorStaffUserId: input.createdByStaffUserId,
      occurredAt: input.now,
    });
    return { agentId, agentVersionId };
  }

  async cloneAgent(input: {
    readonly sourceAgentId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ agentId: string; agentVersionId: string; sourceLabel: string }> {
    this.cloneAgentCalls.push(input);
    const source = this.agents.get(input.sourceAgentId);
    if (!source) throw new Error(`Cannot clone agent "${input.sourceAgentId}": no such agent.`);
    if (!source.currentVersionId) {
      throw new Error(`Cannot clone agent ${source.id}: it has no current version.`);
    }
    const sourceVersion = this.versions.get(source.currentVersionId);
    if (!sourceVersion) {
      throw new Error(`Cannot clone agent ${source.id}: its current version is missing.`);
    }
    const sourceLabel = versionLabel({ major: sourceVersion.major, minor: sourceVersion.minor });

    this.counter += 1;
    const agentId = `agent-${this.counter}`;
    const agentVersionId = `agentversion-${this.counter}`;
    const newName = `${source.name} (copy)`;

    this.agents.set(agentId, {
      id: agentId,
      name: newName,
      slug: slugify(newName),
      description: source.description,
      ownerTenantId: source.ownerTenantId,
      status: "Draft",
      currentVersionId: agentVersionId,
      clonedFromAgentId: source.id,
      createdAt: input.now,
    });
    this.versions.set(agentVersionId, {
      id: agentVersionId,
      agentId,
      major: INITIAL_DRAFT_VERSION.major,
      minor: INITIAL_DRAFT_VERSION.minor,
      status: "Draft",
      isCurrent: true,
      systemPrompt: sourceVersion.systemPrompt,
      tone: sourceVersion.tone,
      primaryModel: sourceVersion.primaryModel,
      fallbackModel: sourceVersion.fallbackModel,
      temperature: sourceVersion.temperature,
      maxOutputTokens: sourceVersion.maxOutputTokens,
      changeSummary: null,
      publishedAt: null,
      clonedFromVersionId: sourceVersion.id,
    });
    this.pushHistory({
      agentId,
      agentVersionId,
      kind: "Cloned",
      note: `Cloned from ${source.name} ${sourceLabel}.`,
      fromVersionId: sourceVersion.id,
      actorStaffUserId: input.actorStaffUserId,
      occurredAt: input.now,
    });
    return { agentId, agentVersionId, sourceLabel };
  }

  async forkOrReuseDraftVersion(input: {
    readonly agentId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ agentVersionId: string; wasForked: boolean }> {
    this.forkOrReuseDraftVersionCalls.push(input);
    const agent = this.agents.get(input.agentId);
    if (!agent)
      throw new Error(`Cannot fork/reuse a draft version: no such agent "${input.agentId}".`);
    if (!agent.currentVersionId) throw new Error(`Agent ${agent.id} has no current version.`);
    const current = this.versions.get(agent.currentVersionId);
    if (!current) throw new Error(`Agent ${agent.id}'s current version is missing.`);

    if (current.status !== "Published") {
      // Already a Draft — nothing to fork, matching `PrismaAgentRepository`'s identical branch.
      return { agentVersionId: current.id, wasForked: false };
    }

    // Fork off the agent's *highest-ever* version, not just `current` — matching the real
    // `PrismaAgentRepository`'s fix for the same bug (see its own doc comment): after a
    // rollback, `current` can be older than a version that still exists, and forking from
    // `current` alone would try to recreate that already-existing (major, minor) pair.
    let highest = current;
    for (const version of this.versions.values()) {
      if (version.agentId !== agent.id) continue;
      if (
        version.major > highest.major ||
        (version.major === highest.major && version.minor > highest.minor)
      ) {
        highest = version;
      }
    }

    this.counter += 1;
    const newVersionId = `agentversion-${this.counter}`;
    const draftVersion = nextDraftVersion({ major: highest.major, minor: highest.minor });
    this.versions.set(newVersionId, {
      id: newVersionId,
      agentId: agent.id,
      major: draftVersion.major,
      minor: draftVersion.minor,
      status: "Draft",
      isCurrent: false,
      systemPrompt: current.systemPrompt,
      tone: current.tone,
      primaryModel: current.primaryModel,
      fallbackModel: current.fallbackModel,
      temperature: current.temperature,
      maxOutputTokens: current.maxOutputTokens,
      changeSummary: null,
      publishedAt: null,
      clonedFromVersionId: current.id,
    });
    return { agentVersionId: newVersionId, wasForked: true };
  }

  async updateVersionConfig(input: UpdateVersionConfigInput): Promise<UpdateVersionConfigResult> {
    const version = this.versions.get(input.agentVersionId);
    if (!version) throw new Error(`No such agent version: "${input.agentVersionId}".`);
    if (version.status === "Published") {
      return {
        ok: false,
        reason: "immutable",
        message: "A Published agent version is immutable; create a new version instead (B2, B3).",
      };
    }
    if (input.systemPrompt !== undefined) version.systemPrompt = input.systemPrompt;
    if (input.tone !== undefined) version.tone = input.tone;
    if (input.primaryModel !== undefined) version.primaryModel = input.primaryModel;
    if (input.fallbackModel !== undefined) version.fallbackModel = input.fallbackModel;
    if (input.temperature !== undefined) version.temperature = input.temperature;
    if (input.maxOutputTokens !== undefined) version.maxOutputTokens = input.maxOutputTokens;
    return { ok: true };
  }

  async publishVersion(input: {
    readonly agentVersionId: string;
    readonly changeSummary: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ ok: true; label: string } | { ok: false; reason: "agent.already_published" }> {
    this.publishVersionCalls.push(input);
    const version = this.versions.get(input.agentVersionId);
    if (!version) throw new Error(`No such agent version: "${input.agentVersionId}".`);
    if (version.status === "Published") return { ok: false, reason: "agent.already_published" };

    const publishedNumber = publishedVersionNumber({ major: version.major, minor: version.minor });
    const label = versionLabel(publishedNumber);

    for (const other of this.versions.values()) {
      if (other.agentId === version.agentId && other.id !== version.id) other.isCurrent = false;
    }
    version.major = publishedNumber.major;
    version.minor = publishedNumber.minor;
    version.status = "Published";
    version.isCurrent = true;
    version.publishedAt = input.now;
    version.changeSummary = input.changeSummary;

    const agent = this.agents.get(version.agentId);
    if (agent) {
      agent.status = "Published";
      agent.currentVersionId = version.id;
    }

    this.pushHistory({
      agentId: version.agentId,
      agentVersionId: version.id,
      kind: "Published",
      note: `Published ${label}${input.changeSummary ? `: ${input.changeSummary}` : ""}.`,
      fromVersionId: null,
      actorStaffUserId: input.actorStaffUserId,
      occurredAt: input.now,
    });
    return { ok: true, label };
  }

  async unpublishAgent(input: {
    readonly agentId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ ok: true } | { ok: false; reason: "agent.not_published" }> {
    this.unpublishAgentCalls.push(input);
    const agent = this.agents.get(input.agentId);
    if (!agent) throw new Error(`No such agent: "${input.agentId}".`);
    if (agent.status !== "Published") return { ok: false, reason: "agent.not_published" };

    agent.status = "Draft";
    this.pushHistory({
      agentId: agent.id,
      agentVersionId: agent.currentVersionId,
      kind: "Unpublished",
      note: "Unpublished — the agent stopped taking new conversations.",
      fromVersionId: null,
      actorStaffUserId: input.actorStaffUserId,
      occurredAt: input.now,
    });
    return { ok: true };
  }

  async archiveAgent(input: {
    readonly agentId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ ok: true } | { ok: false; reason: "agent.bound_to_live_channel" }> {
    this.archiveAgentCalls.push(input);
    if (this.liveChannelBoundAgents.has(input.agentId)) {
      return { ok: false, reason: "agent.bound_to_live_channel" };
    }
    const agent = this.agents.get(input.agentId);
    if (!agent) throw new Error(`No such agent: "${input.agentId}".`);

    // Archiving never clears the current-version pointer — only `Agent.status` changes.
    agent.status = "Archived";
    this.pushHistory({
      agentId: agent.id,
      agentVersionId: null,
      kind: "Archived",
      note: "Archived — removed from the active registry.",
      fromVersionId: null,
      actorStaffUserId: input.actorStaffUserId,
      occurredAt: input.now,
    });
    return { ok: true };
  }

  async rollbackToVersion(input: {
    readonly agentId: string;
    readonly targetVersionId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ ok: true } | { ok: false; reason: "agent.version_is_current" }> {
    this.rollbackToVersionCalls.push(input);
    const target = this.versions.get(input.targetVersionId);
    if (!target) throw new Error(`No such agent version: "${input.targetVersionId}".`);
    if (target.isCurrent) return { ok: false, reason: "agent.version_is_current" };

    for (const version of this.versions.values()) {
      if (version.agentId === input.agentId) version.isCurrent = version.id === target.id;
    }
    const agent = this.agents.get(input.agentId);
    if (agent) agent.currentVersionId = target.id;

    const label = versionLabel({ major: target.major, minor: target.minor });
    this.pushHistory({
      agentId: input.agentId,
      agentVersionId: target.id,
      kind: "RolledBack",
      note: `Rolled back to ${label}.`,
      fromVersionId: target.id,
      actorStaffUserId: input.actorStaffUserId,
      occurredAt: input.now,
    });
    return { ok: true };
  }

  async editAgent(input: {
    readonly agentId: string;
    readonly name?: string;
    readonly description?: string | null;
  }): Promise<void> {
    this.editAgentCalls.push(input);
    const agent = this.agents.get(input.agentId);
    if (!agent) throw new Error(`No such agent: "${input.agentId}".`);
    if (input.name !== undefined) agent.name = input.name;
    if (input.description !== undefined) agent.description = input.description;
  }

  async isBoundToLiveChannel(agentId: string): Promise<boolean> {
    return this.liveChannelBoundAgents.has(agentId);
  }

  async getLatestUsage(agentId: string, asOf: Date): Promise<number | null> {
    void asOf;
    return this.usageByAgent.get(agentId) ?? null;
  }
}

// -------------------------------------------------------------------- WizardDraftRepository ---

export class FakeWizardDraftRepository implements WizardDraftRepository {
  private readonly drafts = new Map<string, WizardDraft>();
  private counter = 0;

  readonly createCalls: {
    agentId: string;
    agentVersionId: string;
    ownerStaffUserId: string;
    now: Date;
  }[] = [];
  readonly saveStepCalls: {
    draftId: string;
    lastStep: number;
    stepStateJson: string;
    now: Date;
  }[] = [];
  readonly deleteForAgentCalls: string[] = [];

  /** Test setup: seed an existing draft directly. */
  seed(draft: WizardDraft): void {
    this.drafts.set(draft.id, draft);
  }

  async findByOwnerAndAgent(
    ownerStaffUserId: string,
    agentId: string,
  ): Promise<WizardDraft | null> {
    for (const draft of this.drafts.values()) {
      if (draft.ownerStaffUserId === ownerStaffUserId && draft.agentId === agentId) return draft;
    }
    return null;
  }

  async create(input: {
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly ownerStaffUserId: string;
    readonly now: Date;
  }): Promise<WizardDraft> {
    this.createCalls.push(input);
    this.counter += 1;
    const draft: WizardDraft = {
      id: `draft-${this.counter}`,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      ownerStaffUserId: input.ownerStaffUserId,
      lastStep: 1,
      stepStateJson: "{}",
      updatedAt: input.now,
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  async saveStep(input: {
    readonly draftId: string;
    readonly lastStep: number;
    readonly stepStateJson: string;
    readonly now: Date;
  }): Promise<void> {
    this.saveStepCalls.push(input);
    const existing = this.drafts.get(input.draftId);
    if (!existing) throw new Error(`No such wizard draft: "${input.draftId}".`);
    this.drafts.set(input.draftId, {
      ...existing,
      lastStep: input.lastStep,
      stepStateJson: input.stepStateJson,
      updatedAt: input.now,
    });
  }

  async deleteForAgent(agentId: string): Promise<void> {
    this.deleteForAgentCalls.push(agentId);
    for (const [id, draft] of [...this.drafts]) {
      if (draft.agentId === agentId) this.drafts.delete(id);
    }
  }
}

// ----------------------------------------------------------------- AgentBindingsRepository ---

export class FakeAgentBindingsRepository implements AgentBindingsRepository {
  private readonly knowledge = new Map<string, readonly KnowledgeBindingRow[]>();
  private readonly flows = new Map<string, readonly FlowBindingRow[]>();
  private readonly channels = new Map<string, readonly ChannelBindingRow[]>();
  private readonly locales = new Map<string, readonly LocaleBindingRow[]>();

  async listKnowledgeBindings(agentVersionId: string): Promise<readonly KnowledgeBindingRow[]> {
    return this.knowledge.get(agentVersionId) ?? [];
  }

  async replaceKnowledgeBindings(
    agentVersionId: string,
    bindings: readonly KnowledgeBindingRow[],
    boundByStaffUserId: string,
    now: Date,
  ): Promise<void> {
    void boundByStaffUserId;
    void now;
    this.knowledge.set(agentVersionId, [...bindings]);
  }

  async listFlowBindings(agentVersionId: string): Promise<readonly FlowBindingRow[]> {
    return this.flows.get(agentVersionId) ?? [];
  }

  async replaceFlowBindings(
    agentVersionId: string,
    bindings: readonly FlowBindingRow[],
    now: Date,
  ): Promise<void> {
    void now;
    this.flows.set(agentVersionId, [...bindings]);
  }

  async listChannelBindings(agentVersionId: string): Promise<readonly ChannelBindingRow[]> {
    return this.channels.get(agentVersionId) ?? [];
  }

  async replaceChannelBindings(
    agentVersionId: string,
    bindings: readonly ChannelBindingRow[],
    now: Date,
  ): Promise<void> {
    void now;
    this.channels.set(agentVersionId, [...bindings]);
  }

  async listLocaleBindings(agentVersionId: string): Promise<readonly LocaleBindingRow[]> {
    return this.locales.get(agentVersionId) ?? [];
  }

  async replaceLocaleBindings(
    agentVersionId: string,
    bindings: readonly LocaleBindingRow[],
    now: Date,
  ): Promise<void> {
    void now;
    this.locales.set(agentVersionId, [...bindings]);
  }
}

// ----------------------------------------------------------------- PolicyOverrideRepository ---

export class FakePolicyOverrideRepository implements PolicyOverrideRepository {
  private readonly catalogue = new Map<string, GuardrailPolicyRow>();
  /** agentId -> policyKey -> override row. */
  private readonly overrides = new Map<string, Map<string, AgentPolicyOverrideRow>>();
  private counter = 0;

  readonly setOverrideCalls: {
    agentId: string;
    policyKey: string;
    mode: "Value" | "Disabled";
    valueJson: string | null;
    reason: string;
    actorStaffUserId: string;
    now: Date;
  }[] = [];
  readonly clearOverrideCalls: { agentId: string; policyKey: string }[] = [];

  /** Test setup: seed one platform catalogue row (`platform.Policies` + `OverridablePolicies`, joined). */
  seedPolicy(policy: GuardrailPolicyRow): void {
    this.catalogue.set(policy.policyKey, policy);
  }

  async listGuardrailPolicies(
    policyKeys: readonly string[],
  ): Promise<readonly GuardrailPolicyRow[]> {
    return policyKeys
      .map((key) => this.catalogue.get(key))
      .filter((policy): policy is GuardrailPolicyRow => policy !== undefined);
  }

  async listOverridesForAgent(agentId: string): Promise<readonly AgentPolicyOverrideRow[]> {
    return [...(this.overrides.get(agentId)?.values() ?? [])];
  }

  async setOverride(input: {
    readonly agentId: string;
    readonly policyKey: string;
    readonly mode: "Value" | "Disabled";
    readonly valueJson: string | null;
    readonly reason: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<void> {
    this.setOverrideCalls.push(input);
    const forAgent = this.overrides.get(input.agentId) ?? new Map<string, AgentPolicyOverrideRow>();
    const existing = forAgent.get(input.policyKey);
    if (!existing) this.counter += 1;
    forAgent.set(input.policyKey, {
      id: existing?.id ?? `override-${this.counter}`,
      policyKey: input.policyKey,
      mode: input.mode,
      valueJson: input.valueJson,
      reason: input.reason,
    });
    this.overrides.set(input.agentId, forAgent);
  }

  async clearOverride(
    agentId: string,
    policyKey: string,
    actorStaffUserId: string,
    now: Date,
  ): Promise<void> {
    void actorStaffUserId;
    void now;
    this.clearOverrideCalls.push({ agentId, policyKey });
    this.overrides.get(agentId)?.delete(policyKey);
  }
}

export function guardrailPolicyFixture(
  overrides: Partial<GuardrailPolicyRow> = {},
): GuardrailPolicyRow {
  return {
    policyKey: "grounding_threshold",
    title: "Refuse below grounding threshold",
    detail: "Refuses to answer when retrieval confidence falls below this threshold.",
    kind: "Threshold",
    defaultValueJson: "0.6",
    isLocked: false,
    ...overrides,
  };
}
