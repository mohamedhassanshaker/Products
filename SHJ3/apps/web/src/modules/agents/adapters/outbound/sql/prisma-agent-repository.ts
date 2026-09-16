/**
 * The real `AgentRepository` — B2's registry and B3 steps 1-3/10, per-tenant.
 *
 * ## The one documented cross-module exception, and why it is safe
 *
 * `cloneAgent()` and `forkOrReuseDraftVersion()` must also deep-copy `ToolBindings`
 * (`docs/api.md` §4.4: clone is "one transaction" including that copy). `modules/agents/`
 * may not import anything from `modules/tools/` (`eslint.config.mjs`'s `boundaries/
 * element-types` forbids it symmetrically, in both directions, at every layer). Resolved
 * the same way `PrismaRoleRepository`'s own doc comment justifies a five-line duplicated
 * query instead of a forced cross-port abstraction: this file reads/writes the
 * `ToolBindings` table **directly** via `getTenantDb()` (a `platform` port every module may
 * use) inside its own `$transaction`, using a narrow, locally-typed row shape — zero
 * TypeScript import from `modules/tools/`, so the lint boundary holds literally, while the
 * real atomicity `docs/api.md` asks for is real. `modules/tools/` remains the sole owner of
 * `ToolBinding`'s actual domain logic (bind/unbind, the trigger-rejection translations, the
 * shared counts query) — this is a one-off, transaction-scoped read+copy, not new business
 * logic living in two places. If a copied binding's target has since become unbindable
 * (its MCP server disconnected, or the skill/connector was soft-deleted since the source
 * was bound), `TR_ToolBindings_serverMustBeConnected` rejects the INSERT and the whole
 * clone/fork rolls back — a real, accepted edge case, translated into a clear error below
 * rather than a raw trigger message.
 *
 * ## `Agent.status` vs `AgentVersion.status`
 *
 * See `domain/version.ts`'s module comment for the full derivation. In short: a Published
 * `AgentVersion` never leaves `'Published'` (a permanent snapshot), so `unpublishAgent`
 * touches only `Agent.status` and never the version row at all.
 */

import { createHash } from "node:crypto";
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type { AgentStatus, ChannelKey, HistoryEntryKind, Tone } from "../../../domain/agent.js";
import { isAgentStatus, isChannelKey, isTone } from "../../../domain/agent.js";
import {
  INITIAL_DRAFT_VERSION,
  nextDraftVersion,
  publishedVersionNumber,
  versionLabel,
  type VersionNumber,
} from "../../../domain/version.js";
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
} from "../../../ports/agent-repository.js";

const OPERATION = "agents repository";

/** `TR_AgentVersions_publishedImmutable`'s real message text (`prisma/sql/001_constraints.sql`), matched the same way `PrismaRoleRepository.findProtectedChange` matches `TR_RolePermissions_protectSuperAdmin` — a stable substring of the trigger's own THROW text, not a structured error code (Prisma does not reliably surface the raw SQL Server error number on this path; substring matching is the already-proven pattern in this codebase, not a novel choice). */
const IMMUTABLE_VERSION_MESSAGE_FRAGMENT = "is immutable; create a new version instead";
const IMMUTABLE_VERSION_MESSAGE =
  "A Published agent version is immutable; create a new version instead (B2, B3).";

/** `TR_ToolBindings_serverMustBeConnected`'s two THROW texts — only relevant here when a clone/fork's ToolBindings copy hits a target that has since become unbindable. */
const TOOL_BINDING_UNAVAILABLE_FRAGMENT = "requires a Connected MCP server and a live tool";
const TOOL_BINDING_SOFT_DELETED_FRAGMENT = "cannot be newly bound";

function isImmutableViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes(IMMUTABLE_VERSION_MESSAGE_FRAGMENT);
}

function toolBindingCopyRejectionMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (error.message.includes(TOOL_BINDING_UNAVAILABLE_FRAGMENT)) {
    return "One of the source agent's bound MCP tools is no longer available (its server disconnected, or the tool was removed), so the copy was refused. Unbind it on the source agent first, then retry.";
  }
  if (error.message.includes(TOOL_BINDING_SOFT_DELETED_FRAGMENT)) {
    return "One of the source agent's bound skills or connectors has since been deleted, so the copy was refused. Unbind it on the source agent first, then retry.";
  }
  return null;
}

// ------------------------------------------------------------------ row mapping ---

interface AgentRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly ownerTenantId: string;
  readonly status: string;
  readonly currentVersionId: string | null;
  readonly clonedFromAgentId: string | null;
  readonly createdAt: Date;
}

function toAgentDetail(row: AgentRow): AgentDetail {
  if (!isAgentStatus(row.status)) {
    throw new Error(
      `Agent ${row.id} has an unrecognized status "${row.status}" — data corruption or a schema/domain drift.`,
    );
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    ownerTenantId: row.ownerTenantId,
    status: row.status,
    currentVersionId: row.currentVersionId,
    clonedFromAgentId: row.clonedFromAgentId,
    createdAt: row.createdAt,
  };
}

interface AgentVersionRow {
  readonly id: string;
  readonly agentId: string;
  readonly major: number;
  readonly minor: number;
  readonly status: string;
  readonly isCurrent: boolean;
  readonly systemPrompt: string;
  readonly tone: string;
  readonly primaryModel: string;
  readonly fallbackModel: string | null;
  readonly temperature: unknown; // Prisma Decimal
  readonly maxOutputTokens: number;
  readonly changeSummary: string | null;
  readonly publishedAt: Date | null;
  readonly clonedFromVersionId: string | null;
}

function toAgentVersionDetail(row: AgentVersionRow): AgentVersionDetail {
  if (!isAgentStatus(row.status) || !isTone(row.tone)) {
    throw new Error(
      `AgentVersion ${row.id} has an unrecognized status/tone — data corruption or a schema/domain drift.`,
    );
  }
  const version: VersionNumber = { major: row.major, minor: row.minor };
  return {
    id: row.id,
    agentId: row.agentId,
    version,
    label: versionLabel(version),
    status: row.status,
    isCurrent: row.isCurrent,
    systemPrompt: row.systemPrompt,
    tone: row.tone,
    primaryModel: row.primaryModel,
    fallbackModel: row.fallbackModel,
    temperature: Number(row.temperature),
    maxOutputTokens: row.maxOutputTokens,
    changeSummary: row.changeSummary,
    publishedAt: row.publishedAt,
    clonedFromVersionId: row.clonedFromVersionId,
  };
}

// -------------------------------------------------------------------- slug/hash ---

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent"
  );
}

/**
 * Disambiguated against existing **live** slugs (`UQ_Agents_slug ... WHERE deletedAt IS
 * NULL`), mirroring `PrismaRoleRepository.uniqueRoleKey`'s exact precedent for the same
 * problem shape.
 */
async function uniqueSlug(db: ReturnType<typeof getTenantDb>, name: string): Promise<string> {
  const base = slugify(name);
  const existing = await db.agent.findMany({ where: { deletedAt: null }, select: { slug: true } });
  const taken = new Set(existing.map((row) => row.slug));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * `AgentVersions.configHash CHAR(64)` — a deterministic digest of the scalar config
 * columns `TR_AgentVersions_publishedImmutable` itself guards, so a real content change
 * always changes the hash the trigger compares. Persistence-layer plumbing (detecting
 * "did the config actually change"), not a domain rule, which is why it lives here and not
 * in `domain/` — matching this codebase's own convention of keeping `node:crypto` usage in
 * adapters (`ulid.ts`, `redis-session-store.ts`), never in a pure module.
 */
function computeConfigHash(config: {
  readonly systemPrompt: string;
  readonly tone: string;
  readonly primaryModel: string;
  readonly fallbackModel: string | null;
  readonly temperature: number;
  readonly maxOutputTokens: number;
}): string {
  const canonical = JSON.stringify([
    config.systemPrompt,
    config.tone,
    config.primaryModel,
    config.fallbackModel,
    config.temperature,
    config.maxOutputTokens,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

const DEFAULT_VERSION_CONFIG = {
  systemPrompt: "",
  tone: "Helpful" as Tone,
  primaryModel: "claude-sonnet-5",
  fallbackModel: null as string | null,
  temperature: 0.7,
  maxOutputTokens: 1024,
};

// -------------------------------------------------------------- binding copying ---

/**
 * The four per-version binding tables, deep-copied verbatim for both `cloneAgent` and
 * `forkOrReuseDraftVersion` — extracted once so the two callers cannot silently drift
 * from each other. Returns Prisma operations to append to the caller's own
 * `$transaction` array; does not execute anything itself.
 */
async function bindingCopyOperations(
  db: ReturnType<typeof getTenantDb>,
  fromVersionId: string,
  toVersionId: string,
  actorStaffUserId: string,
  now: Date,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma's per-model create-args types are not worth threading through a shared helper for four structurally-different tables.
): Promise<any[]> {
  const [knowledge, flows, channels, locales, toolBindings] = await Promise.all([
    db.agentKnowledgeBinding.findMany({ where: { agentVersionId: fromVersionId } }),
    db.agentFlowBinding.findMany({ where: { agentVersionId: fromVersionId } }),
    db.agentChannelBinding.findMany({ where: { agentVersionId: fromVersionId } }),
    db.agentLocaleBinding.findMany({ where: { agentVersionId: fromVersionId } }),
    // The one documented cross-module read — see this file's module comment.
    db.toolBinding.findMany({ where: { agentVersionId: fromVersionId } }),
  ]);

  let tick = 0;
  const stamp = () => new Date(now.getTime() + tick++);

  return [
    ...knowledge.map((b) =>
      db.agentKnowledgeBinding.create({
        data: {
          id: newUlid(stamp()),
          agentVersionId: toVersionId,
          knowledgeCollectionId: b.knowledgeCollectionId,
          isEnabled: b.isEnabled,
          boundByStaffUserId: actorStaffUserId,
          boundAt: now,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ),
    ...flows.map((b) =>
      db.agentFlowBinding.create({
        data: {
          id: newUlid(stamp()),
          agentVersionId: toVersionId,
          flowId: b.flowId,
          flowVersionId: b.flowVersionId,
          isEnabled: b.isEnabled,
          ordinal: b.ordinal,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ),
    ...channels.map((b) =>
      db.agentChannelBinding.create({
        data: {
          id: newUlid(stamp()),
          agentVersionId: toVersionId,
          channelKey: b.channelKey,
          isEnabled: b.isEnabled,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ),
    ...locales.map((b) =>
      db.agentLocaleBinding.create({
        data: {
          id: newUlid(stamp()),
          agentVersionId: toVersionId,
          localeCode: b.localeCode,
          isPrimary: b.isPrimary,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ),
    ...toolBindings.map((b) =>
      db.toolBinding.create({
        data: {
          id: newUlid(stamp()),
          agentVersionId: toVersionId,
          targetKind: b.targetKind,
          skillId: b.skillId,
          mcpToolId: b.mcpToolId,
          apiConnectorId: b.apiConnectorId,
          isEnabled: b.isEnabled,
          argumentPolicyJson: b.argumentPolicyJson,
          requiredAssurance: b.requiredAssurance,
          rateLimitPolicyId: b.rateLimitPolicyId,
          boundByStaffUserId: actorStaffUserId,
          boundAt: now,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ),
  ];
}

export class PrismaAgentRepository implements AgentRepository {
  async listForRegistry(filter?: {
    readonly status?: AgentStatus;
    readonly q?: string;
  }): Promise<readonly AgentRegistryRow[]> {
    const db = getTenantDb(OPERATION);
    const agents = await db.agent.findMany({
      where: {
        deletedAt: null,
        ...(filter?.status ? { status: filter.status } : {}),
        ...(filter?.q ? { name: { contains: filter.q } } : {}),
      },
      orderBy: { name: "asc" },
    });

    const now = new Date();
    return Promise.all(
      agents.map(async (agent): Promise<AgentRegistryRow> => {
        const [version, channelBindings, usage] = await Promise.all([
          agent.currentVersionId
            ? db.agentVersion.findUnique({ where: { id: agent.currentVersionId } })
            : Promise.resolve(null),
          agent.currentVersionId
            ? db.agentChannelBinding.findMany({
                where: { agentVersionId: agent.currentVersionId, isEnabled: true },
              })
            : Promise.resolve([]),
          this.getLatestUsage(agent.id, now),
        ]);

        if (!isAgentStatus(agent.status)) {
          throw new Error(`Agent ${agent.id} has an unrecognized status "${agent.status}".`);
        }

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
          enabledChannelKeys: channelBindings
            .map((b) => b.channelKey)
            .filter((key): key is ChannelKey => isChannelKey(key)),
          usagePerDay: usage,
        };
      }),
    );
  }

  async getAgentDetail(agentId: string): Promise<AgentDetail | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.agent.findFirst({ where: { id: agentId, deletedAt: null } });
    return row ? toAgentDetail(row) : null;
  }

  async findAgentBySlug(slug: string): Promise<AgentDetail | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.agent.findFirst({ where: { slug, deletedAt: null } });
    return row ? toAgentDetail(row) : null;
  }

  async getVersion(agentVersionId: string): Promise<AgentVersionDetail | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.agentVersion.findFirst({ where: { id: agentVersionId, deletedAt: null } });
    return row ? toAgentVersionDetail(row) : null;
  }

  async listVersions(agentId: string): Promise<readonly AgentVersionSummary[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.agentVersion.findMany({
      where: { agentId, deletedAt: null },
      orderBy: [{ major: "desc" }, { minor: "desc" }],
    });
    return rows.map((row) => {
      if (!isAgentStatus(row.status)) {
        throw new Error(`AgentVersion ${row.id} has an unrecognized status "${row.status}".`);
      }
      const version: VersionNumber = { major: row.major, minor: row.minor };
      return {
        id: row.id,
        version,
        label: versionLabel(version),
        status: row.status,
        isCurrent: row.isCurrent,
        changeSummary: row.changeSummary,
        publishedAt: row.publishedAt,
      };
    });
  }

  async listVersionHistory(agentId: string): Promise<readonly AgentVersionHistoryEntryRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.agentVersionHistoryEntry.findMany({
      where: { agentId },
      orderBy: { occurredAt: "desc" },
    });
    return rows.map((row) => {
      const kind = row.kind as HistoryEntryKind;
      return {
        id: row.id,
        agentVersionId: row.agentVersionId,
        kind,
        note: row.note,
        fromVersionId: row.fromVersionId,
        actorStaffUserId: row.actorStaffUserId,
        occurredAt: row.occurredAt,
      };
    });
  }

  /**
   * Note on `AgentLocaleBindings`: a brand-new agent starts with **zero** locale bindings —
   * none of the 10 wizard steps in this wave manage them (there is no dedicated "locale"
   * step; `AgentLocaleBindings` exists to be read by the Arabic-parity publish gate, B10
   * tab 5/B13 tab 3, neither of which is built yet). `bindingCopyOperations` still copies
   * whatever locale bindings a *cloned or forked* version already had, so this is a gap
   * only for genuinely new agents, not a silent inconsistency for existing ones — flagged
   * here rather than papered over with an invented default this wave has no real UI for.
   */
  async createAgent(input: NewAgentInput): Promise<{ agentId: string; agentVersionId: string }> {
    const db = getTenantDb(OPERATION);
    const { now } = input;
    const slug = await uniqueSlug(db, input.name);
    const agentId = newUlid(now);
    const versionId = newUlid(new Date(now.getTime() + 1));
    const historyId = newUlid(new Date(now.getTime() + 2));
    const configHash = computeConfigHash(DEFAULT_VERSION_CONFIG);

    // Agent.currentVersionId -> AgentVersion.id and AgentVersion.agentId -> Agent.id form a
    // cycle neither direction can satisfy on first insert (SQL Server checks FKs
    // immediately, not deferred) — so Agent is created with currentVersionId null first,
    // then updated once the version row exists, all inside one transaction.
    await db.$transaction([
      db.agent.create({
        data: {
          id: agentId,
          name: input.name,
          slug,
          description: input.description,
          ownerTenantId: input.ownerTenantId,
          status: "Draft",
          currentVersionId: null,
          clonedFromAgentId: null,
          createdByStaffUserId: input.createdByStaffUserId,
          archivedAt: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
      db.agentVersion.create({
        data: {
          id: versionId,
          agentId,
          major: INITIAL_DRAFT_VERSION.major,
          minor: INITIAL_DRAFT_VERSION.minor,
          status: "Draft",
          isCurrent: true,
          ...DEFAULT_VERSION_CONFIG,
          changeSummary: null,
          configHash,
          createdByStaffUserId: input.createdByStaffUserId,
          publishedAt: null,
          publishedByStaffUserId: null,
          clonedFromVersionId: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
      db.agent.update({
        where: { id: agentId },
        data: { currentVersionId: versionId, updatedAt: now },
      }),
      db.agentVersionHistoryEntry.create({
        data: {
          id: historyId,
          agentId,
          agentVersionId: versionId,
          kind: "Created",
          note: `Created "${input.name}" as a Draft.`,
          fromVersionId: null,
          actorStaffUserId: input.createdByStaffUserId,
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ]);

    return { agentId, agentVersionId: versionId };
  }

  async cloneAgent(input: {
    readonly sourceAgentId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ agentId: string; agentVersionId: string; sourceLabel: string }> {
    const db = getTenantDb(OPERATION);
    const { now, actorStaffUserId } = input;

    const source = await db.agent.findFirstOrThrow({
      where: { id: input.sourceAgentId, deletedAt: null },
    });
    if (!source.currentVersionId) {
      throw new Error(
        `Cannot clone agent ${source.id}: it has no current version, which should be impossible for a well-formed Agent row.`,
      );
    }
    const sourceVersion = await db.agentVersion.findFirstOrThrow({
      where: { id: source.currentVersionId },
    });
    const sourceLabel = versionLabel({ major: sourceVersion.major, minor: sourceVersion.minor });

    const newAgentId = newUlid(now);
    const newVersionId = newUlid(new Date(now.getTime() + 1));
    const newName = `${source.name} (copy)`;
    const newSlug = await uniqueSlug(db, newName);
    const configHash = computeConfigHash({
      systemPrompt: sourceVersion.systemPrompt,
      tone: sourceVersion.tone,
      primaryModel: sourceVersion.primaryModel,
      fallbackModel: sourceVersion.fallbackModel,
      temperature: Number(sourceVersion.temperature),
      maxOutputTokens: sourceVersion.maxOutputTokens,
    });

    const bindingOps = await bindingCopyOperations(
      db,
      sourceVersion.id,
      newVersionId,
      actorStaffUserId,
      now,
    );

    const guardrailOverrides = await db.policyOverride.findMany({
      where: { agentId: source.id, removedAt: null },
    });

    let tick = bindingOps.length + 10;
    const stamp = () => new Date(now.getTime() + tick++);

    try {
      await db.$transaction([
        db.agent.create({
          data: {
            id: newAgentId,
            name: newName,
            slug: newSlug,
            description: source.description,
            ownerTenantId: source.ownerTenantId,
            status: "Draft",
            currentVersionId: null,
            clonedFromAgentId: source.id,
            createdByStaffUserId: actorStaffUserId,
            archivedAt: null,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
        db.agentVersion.create({
          data: {
            id: newVersionId,
            agentId: newAgentId,
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
            configHash,
            createdByStaffUserId: actorStaffUserId,
            publishedAt: null,
            publishedByStaffUserId: null,
            clonedFromVersionId: sourceVersion.id,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
        db.agent.update({
          where: { id: newAgentId },
          data: { currentVersionId: newVersionId, updatedAt: now },
        }),
        ...bindingOps,
        ...guardrailOverrides.map((o) =>
          db.policyOverride.create({
            data: {
              id: newUlid(stamp()),
              agentId: newAgentId,
              policyKey: o.policyKey,
              mode: o.mode,
              valueJson: o.valueJson,
              reason: o.reason,
              createdByStaffUserId: actorStaffUserId,
              removedByStaffUserId: null,
              removedAt: null,
              createdAt: now,
              updatedAt: now,
            },
          }),
        ),
        db.agentVersionHistoryEntry.create({
          data: {
            id: newUlid(stamp()),
            agentId: newAgentId,
            agentVersionId: newVersionId,
            kind: "Cloned",
            note: `Cloned from ${source.name} ${sourceLabel}.`,
            fromVersionId: sourceVersion.id,
            actorStaffUserId,
            occurredAt: now,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ]);
    } catch (error) {
      const rejection = toolBindingCopyRejectionMessage(error);
      if (rejection) throw new Error(rejection);
      throw error;
    }

    return { agentId: newAgentId, agentVersionId: newVersionId, sourceLabel };
  }

  async forkOrReuseDraftVersion(input: {
    readonly agentId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ agentVersionId: string; wasForked: boolean }> {
    const db = getTenantDb(OPERATION);
    const { now, actorStaffUserId } = input;

    const agent = await db.agent.findFirstOrThrow({
      where: { id: input.agentId, deletedAt: null },
    });
    if (!agent.currentVersionId) {
      throw new Error(
        `Agent ${agent.id} has no current version — cannot open the wizard against it.`,
      );
    }
    const current = await db.agentVersion.findFirstOrThrow({
      where: { id: agent.currentVersionId },
    });

    if (current.status !== "Published") {
      // Already a Draft (or an Archived version left current by some other path) — nothing
      // to fork, the wizard edits it directly.
      return { agentVersionId: current.id, wasForked: false };
    }

    // The next version number must be strictly newer than *every* version this agent has
    // ever had, not just `current` — a real bug found by this wave's own live-infrastructure
    // proof (B-3): `Agent.currentVersionId` can point at an *older* version than the agent's
    // true history after a `RollbackAgentVersion` (rollback only changes which version is
    // current, per B2's own `[rule]` — it never deletes or renumbers the version it rolled
    // back past). Computing `nextDraftVersion` from `current` alone then tries to recreate a
    // version number that already exists (e.g. roll back v1.1 -> v1.0 as current, reopen the
    // wizard: `nextDraftVersion(v1.0)` = v1.1, which is still a real, existing row), and
    // `UQ_AgentVersions_agentId_major_minor` correctly rejects the duplicate. Basing the fork
    // on the highest (major, minor) this agent has ever reached — `current` is always one of
    // the candidates, so this is a no-op in the ordinary case where `current` already is the
    // maximum — makes every forked version number genuinely new, matching Rollback's own
    // documented semantics ("changes which version is current", never erases or reopens
    // history) rather than colliding with it.
    const highestVersion = await db.agentVersion.findFirstOrThrow({
      where: { agentId: agent.id },
      orderBy: [{ major: "desc" }, { minor: "desc" }],
    });
    const draftVersion = nextDraftVersion({
      major: highestVersion.major,
      minor: highestVersion.minor,
    });
    const newVersionId = newUlid(now);
    const configHash = computeConfigHash({
      systemPrompt: current.systemPrompt,
      tone: current.tone,
      primaryModel: current.primaryModel,
      fallbackModel: current.fallbackModel,
      temperature: Number(current.temperature),
      maxOutputTokens: current.maxOutputTokens,
    });

    const bindingOps = await bindingCopyOperations(
      db,
      current.id,
      newVersionId,
      actorStaffUserId,
      now,
    );

    try {
      await db.$transaction([
        db.agentVersion.create({
          data: {
            id: newVersionId,
            agentId: agent.id,
            major: draftVersion.major,
            minor: draftVersion.minor,
            // Not current yet — the prior Published version stays current (and stays live)
            // until this draft is itself published. Editing a draft must never silently
            // change which version conversations are actually routed against.
            status: "Draft",
            isCurrent: false,
            systemPrompt: current.systemPrompt,
            tone: current.tone,
            primaryModel: current.primaryModel,
            fallbackModel: current.fallbackModel,
            temperature: current.temperature,
            maxOutputTokens: current.maxOutputTokens,
            changeSummary: null,
            configHash,
            createdByStaffUserId: actorStaffUserId,
            publishedAt: null,
            publishedByStaffUserId: null,
            clonedFromVersionId: current.id,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
        ...bindingOps,
      ]);
    } catch (error) {
      const rejection = toolBindingCopyRejectionMessage(error);
      if (rejection) throw new Error(rejection);
      throw error;
    }

    return { agentVersionId: newVersionId, wasForked: true };
  }

  async updateVersionConfig(input: UpdateVersionConfigInput): Promise<UpdateVersionConfigResult> {
    const db = getTenantDb(OPERATION);
    const current = await db.agentVersion.findFirstOrThrow({ where: { id: input.agentVersionId } });

    const next = {
      systemPrompt: input.systemPrompt ?? current.systemPrompt,
      tone: input.tone ?? current.tone,
      primaryModel: input.primaryModel ?? current.primaryModel,
      fallbackModel:
        input.fallbackModel !== undefined ? input.fallbackModel : current.fallbackModel,
      temperature: input.temperature ?? Number(current.temperature),
      maxOutputTokens: input.maxOutputTokens ?? current.maxOutputTokens,
    };

    try {
      await db.agentVersion.update({
        where: { id: input.agentVersionId },
        data: { ...next, configHash: computeConfigHash(next), updatedAt: input.now },
      });
      return { ok: true };
    } catch (error) {
      if (isImmutableViolation(error)) {
        return { ok: false, reason: "immutable", message: IMMUTABLE_VERSION_MESSAGE };
      }
      throw error;
    }
  }

  async publishVersion(input: {
    readonly agentVersionId: string;
    readonly changeSummary: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ ok: true; label: string } | { ok: false; reason: "agent.already_published" }> {
    const db = getTenantDb(OPERATION);
    const { now, actorStaffUserId } = input;

    const version = await db.agentVersion.findFirstOrThrow({ where: { id: input.agentVersionId } });
    if (version.status === "Published") {
      return { ok: false, reason: "agent.already_published" };
    }

    const publishedNumber = publishedVersionNumber({ major: version.major, minor: version.minor });
    const label = versionLabel(publishedNumber);
    const historyId = newUlid(new Date(now.getTime() + 1));

    // Un-current whichever version was current before, if it differs from this one (a
    // brand-new agent's first publish has no such predecessor). This MUST run — and, within
    // the transaction, MUST be ordered — before this version's own isCurrent flips to true:
    // `UQ_AgentVersions_agentId_current WHERE isCurrent = 1` is checked per-statement (SQL
    // Server does not defer unique-index checks to commit), so having two rows briefly both
    // isCurrent = true, even mid-transaction, is a real, immediate constraint violation —
    // not just a logically-undesirable intermediate state.
    const previousCurrent = await db.agentVersion.findFirst({
      where: { agentId: version.agentId, isCurrent: true, id: { not: version.id } },
    });

    const ops = [
      ...(previousCurrent
        ? [
            db.agentVersion.update({
              where: { id: previousCurrent.id },
              data: { isCurrent: false, updatedAt: now },
            }),
          ]
        : []),
      db.agentVersion.update({
        where: { id: version.id },
        data: {
          major: publishedNumber.major,
          minor: publishedNumber.minor,
          status: "Published",
          isCurrent: true,
          publishedAt: now,
          publishedByStaffUserId: actorStaffUserId,
          changeSummary: input.changeSummary,
          updatedAt: now,
        },
      }),
      db.agent.update({
        where: { id: version.agentId },
        data: { status: "Published", currentVersionId: version.id, updatedAt: now },
      }),
      db.agentVersionHistoryEntry.create({
        data: {
          id: historyId,
          agentId: version.agentId,
          agentVersionId: version.id,
          kind: "Published",
          note: `Published ${label}${input.changeSummary ? `: ${input.changeSummary}` : ""}.`,
          fromVersionId: null,
          actorStaffUserId,
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ];

    await db.$transaction(ops);
    return { ok: true, label };
  }

  async unpublishAgent(input: {
    readonly agentId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ ok: true } | { ok: false; reason: "agent.not_published" }> {
    const db = getTenantDb(OPERATION);
    const { now, actorStaffUserId } = input;

    const agent = await db.agent.findFirstOrThrow({
      where: { id: input.agentId, deletedAt: null },
    });
    if (agent.status !== "Published") {
      return { ok: false, reason: "agent.not_published" };
    }

    await db.$transaction([
      // Agent.status only — AgentVersion.status is a permanent record once Published (see
      // this file's module comment); nothing here touches the version row at all.
      db.agent.update({ where: { id: agent.id }, data: { status: "Draft", updatedAt: now } }),
      db.agentVersionHistoryEntry.create({
        data: {
          id: newUlid(now),
          agentId: agent.id,
          agentVersionId: agent.currentVersionId,
          kind: "Unpublished",
          note: "Unpublished — the agent stopped taking new conversations.",
          fromVersionId: null,
          actorStaffUserId,
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ]);
    return { ok: true };
  }

  async archiveAgent(input: {
    readonly agentId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ ok: true } | { ok: false; reason: "agent.bound_to_live_channel" }> {
    const db = getTenantDb(OPERATION);
    const { now, actorStaffUserId } = input;

    if (await this.isBoundToLiveChannel(input.agentId)) {
      return { ok: false, reason: "agent.bound_to_live_channel" };
    }

    await db.$transaction([
      db.agent.update({
        where: { id: input.agentId },
        data: { status: "Archived", archivedAt: now, updatedAt: now },
      }),
      db.agentVersionHistoryEntry.create({
        data: {
          id: newUlid(now),
          agentId: input.agentId,
          agentVersionId: null,
          kind: "Archived",
          note: "Archived — removed from the active registry.",
          fromVersionId: null,
          actorStaffUserId,
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ]);
    return { ok: true };
  }

  async rollbackToVersion(input: {
    readonly agentId: string;
    readonly targetVersionId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ ok: true } | { ok: false; reason: "agent.version_is_current" }> {
    const db = getTenantDb(OPERATION);
    const { now, actorStaffUserId } = input;

    const target = await db.agentVersion.findFirstOrThrow({ where: { id: input.targetVersionId } });
    if (target.agentId !== input.agentId) {
      throw new Error(
        `rollbackToVersion: version ${target.id} belongs to agent ${target.agentId}, not ${input.agentId} — refusing rather than silently operating on the wrong agent's current-version state.`,
      );
    }
    if (target.isCurrent) {
      return { ok: false, reason: "agent.version_is_current" };
    }

    // Every WHERE clause below keys on `target.agentId` (the version row's own truth),
    // never `input.agentId` directly, even though the mismatch check above already
    // guarantees they're equal here — so a future edit that loosens or removes that check
    // cannot silently reintroduce the "wrong agent's isCurrent flags get cleared" bug this
    // guards against.
    const label = versionLabel({ major: target.major, minor: target.minor });
    await db.$transaction([
      db.agentVersion.updateMany({
        where: { agentId: target.agentId, isCurrent: true },
        data: { isCurrent: false, updatedAt: now },
      }),
      db.agentVersion.update({
        where: { id: target.id },
        data: { isCurrent: true, updatedAt: now },
      }),
      db.agent.update({
        where: { id: target.agentId },
        data: { currentVersionId: target.id, updatedAt: now },
      }),
      db.agentVersionHistoryEntry.create({
        data: {
          id: newUlid(now),
          agentId: target.agentId,
          agentVersionId: target.id,
          kind: "RolledBack",
          note: `Rolled back to ${label}.`,
          fromVersionId: target.id,
          actorStaffUserId,
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ]);
    return { ok: true };
  }

  async editAgent(input: {
    readonly agentId: string;
    readonly name?: string;
    readonly description?: string | null;
  }): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.agent.update({
      where: { id: input.agentId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        updatedAt: new Date(),
      },
    });
  }

  async isBoundToLiveChannel(agentId: string): Promise<boolean> {
    const db = getTenantDb(OPERATION);
    const count = await db.channel.count({ where: { boundAgentId: agentId, state: "Live" } });
    return count > 0;
  }

  async getLatestUsage(agentId: string, asOf: Date): Promise<number | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.agentUsageDaily.findFirst({
      where: { agentId, metricDate: { lte: asOf } },
      orderBy: { metricDate: "desc" },
    });
    return row ? row.conversationCount : null;
  }
}
