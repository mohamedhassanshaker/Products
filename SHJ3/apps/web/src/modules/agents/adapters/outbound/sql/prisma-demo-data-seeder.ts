/**
 * The real `DemoDataSeeder` for the agent registry — writes `Agents`/`AgentVersions`/
 * `AgentVersionHistoryEntries`/`AgentChannelBindings` directly, bypassing the ordinary B2/B3
 * use cases for exactly the reasons `demo-data-seeder.ts`'s own doc comment gives (an
 * arbitrary historical version number, a version that is Published from the moment it is
 * written, a whole multi-version history landed in one call rather than one real publish at
 * a time).
 *
 * Every `*ByStaffUserId` attribution column this file writes uses `SYSTEM_SEED_ACTOR_ID`
 * rather than a real `StaffUsers.id`, mirroring `iam`'s own `PrismaDemoDataSeeder` exactly —
 * honest, since none of these rows were actually created by a human, and safe, since these
 * columns are plain `Char(26)`, not FK-enforced against `platform.StaffUsers` (confirmed
 * against `prisma/tenant/schema.prisma`, the same way `iam`'s own seeder confirms it for its
 * tables).
 *
 * ## Synthetic dates, not caller-supplied ones
 *
 * `docs/SHJ3-wireframes-guide.md`'s B2 version-history table gives version numbers, statuses
 * and change summaries — never a real calendar date. Rather than push that fabrication onto
 * whatever eventually calls this port, every version's `publishedAt` is derived here from a
 * fixed, documented interval (`VERSION_INTERVAL_MS`, oldest to newest), ending at "now" for
 * the current version. This mirrors `iam`'s own `PrismaDemoDataSeeder`, none of whose seed
 * methods accept a `now`/actor parameter either — both read the wall clock and a fixed
 * system-seed actor id internally instead.
 *
 * ## Scalar config
 *
 * The seed table this wave specifies (owner tenant / current version / status / channels /
 * version history) says nothing about system prompt, tone, model or temperature, so every
 * seeded version shares the same platform-default scalar config
 * (`SEEDED_VERSION_CONFIG`, matching `PrismaAgentRepository.DEFAULT_VERSION_CONFIG`'s own
 * values for a brand-new Draft) rather than inventing wizard-step content the brief never
 * gave. `configHash` is recomputed locally rather than imported from `prisma-agent-
 * repository.ts` — a small, deliberate duplication of the same kind `agent-bindings-
 * repository.ts`'s own module comment already accepts for this codebase, since that file is a
 * sibling wave's already-reviewed adapter, not this seed's to modify.
 *
 * ## Channel bindings, delegated rather than duplicated
 *
 * Written through the real `PrismaAgentBindingsRepository` (same module, so no boundary is
 * crossed) rather than reimplemented here — its own delete-then-recreate transaction is
 * exactly the full-set-replace a seed needs, and reusing it means this file cannot silently
 * drift from the one real implementation of that rule.
 */

import { createHash } from "node:crypto";
import {
  getPlatformDb,
  getTenantDb,
} from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { currentTenant } from "../../../../platform/tenancy/tenant-context.js";
import type { TenantSlug } from "../../../../platform/tenancy/tenant-slug.js";
import type { ChannelKey } from "../../../domain/agent.js";
import { versionLabel } from "../../../domain/version.js";
import type { DemoDataSeeder } from "../../../ports/demo-data-seeder.js";
import { PrismaAgentBindingsRepository } from "./prisma-agent-bindings-repository.js";

const OPERATION = "agents demo data seeder";

/**
 * A synthetic, never-persisted-as-a-real-user CHAR(26) id — computed, not hand-typed, so its
 * length is correct by construction. Identical construction to `iam`'s own
 * `PrismaDemoDataSeeder.SYSTEM_SEED_ACTOR_ID`, duplicated locally (not imported — that file
 * belongs to a sibling wave) for consistency across this codebase's seed scripts.
 */
const SYSTEM_SEED_ACTOR_ID = `SEED${"0".repeat(21)}1`;

/** Two weeks apart, oldest to newest — a plausible, clearly-synthetic release cadence. The wireframe gives no real dates, so these are illustrative only. */
const VERSION_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

/** See this file's own module comment for why every seeded version shares this one config. */
const SEEDED_VERSION_CONFIG = {
  systemPrompt: "",
  tone: "Helpful",
  primaryModel: "claude-sonnet-5",
  fallbackModel: null as string | null,
  temperature: 0.7,
  maxOutputTokens: 1024,
};

function computeConfigHash(): string {
  const canonical = JSON.stringify([
    SEEDED_VERSION_CONFIG.systemPrompt,
    SEEDED_VERSION_CONFIG.tone,
    SEEDED_VERSION_CONFIG.primaryModel,
    SEEDED_VERSION_CONFIG.fallbackModel,
    SEEDED_VERSION_CONFIG.temperature,
    SEEDED_VERSION_CONFIG.maxOutputTokens,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

function assertMatchesAmbientTenant(tenant: TenantSlug): void {
  const ambient = currentTenant(OPERATION);
  if (ambient !== tenant) {
    throw new Error(
      `${OPERATION}: called for tenant "${tenant}" but the ambient bound tenant is "${ambient}". ` +
        "getTenantDb() resolves the schema from the ambient context, not this argument.",
    );
  }
}

export class PrismaDemoDataSeeder implements DemoDataSeeder {
  async ensureAgentWithHistory(input: {
    readonly ownerTenant: TenantSlug;
    readonly name: string;
    readonly slug: string;
    readonly description: string | null;
    readonly versions: readonly {
      readonly major: number;
      readonly minor: number;
      readonly status: "Draft" | "Published";
      readonly changeSummary: string | null;
    }[];
    readonly enabledChannelKeys: readonly ChannelKey[];
  }): Promise<{ agentId: string; currentVersionId: string }> {
    assertMatchesAmbientTenant(input.ownerTenant);
    if (input.versions.length === 0) {
      throw new Error(`Cannot seed agent "${input.name}": at least one version is required.`);
    }

    const db = getTenantDb(OPERATION);
    const platformDb = getPlatformDb(OPERATION);
    const now = new Date();
    const configHash = computeConfigHash();
    const versionCount = input.versions.length;

    // Oldest first, spaced VERSION_INTERVAL_MS apart, ending at `now` for the newest.
    const dateForIndex = (index: number): Date =>
      new Date(now.getTime() - (versionCount - 1 - index) * VERSION_INTERVAL_MS);

    const tenantRow = await platformDb.tenant.findUniqueOrThrow({
      where: { slug: input.ownerTenant },
      select: { id: true },
    });

    // 1. Agent shell — create-or-find by slug.
    const existingAgent = await db.agent.findFirst({
      where: { slug: input.slug, deletedAt: null },
    });
    const agent =
      existingAgent ??
      (await db.agent.create({
        data: {
          id: newUlid(dateForIndex(0)),
          name: input.name,
          slug: input.slug,
          description: input.description,
          ownerTenantId: tenantRow.id,
          status: "Draft",
          currentVersionId: null,
          clonedFromAgentId: null,
          createdByStaffUserId: SYSTEM_SEED_ACTOR_ID,
          archivedAt: null,
          deletedAt: null,
          createdAt: dateForIndex(0),
          updatedAt: dateForIndex(0),
        },
      }));

    // 2. Every historical version, oldest first — create-or-find by (agentId, major, minor).
    let currentVersionId: string | null = null;
    let finalStatus: "Draft" | "Published" = "Draft";

    for (const [index, versionSeed] of input.versions.entries()) {
      const isLast = index === versionCount - 1;
      const occurredAt = dateForIndex(index);
      const publishedAt = versionSeed.status === "Published" ? occurredAt : null;

      const existingVersion = await db.agentVersion.findFirst({
        where: { agentId: agent.id, major: versionSeed.major, minor: versionSeed.minor },
      });
      const version =
        existingVersion ??
        (await db.agentVersion.create({
          data: {
            id: newUlid(occurredAt),
            agentId: agent.id,
            major: versionSeed.major,
            minor: versionSeed.minor,
            status: versionSeed.status,
            isCurrent: isLast,
            ...SEEDED_VERSION_CONFIG,
            changeSummary: versionSeed.changeSummary,
            configHash,
            createdByStaffUserId: SYSTEM_SEED_ACTOR_ID,
            publishedAt,
            publishedByStaffUserId: publishedAt ? SYSTEM_SEED_ACTOR_ID : null,
            clonedFromVersionId: null,
            deletedAt: null,
            createdAt: occurredAt,
            updatedAt: occurredAt,
          },
        }));

      if (!existingVersion) {
        // History: 'Created' for the very first version ever, 'Published' for every version
        // that is Published — a seeded agent's oldest version can be both at once (e.g.
        // SEWA's v1.2, already Published in the narrative from day one).
        if (index === 0) {
          await this.ensureHistoryEntry(db, {
            agentId: agent.id,
            agentVersionId: version.id,
            kind: "Created",
            note: `Created "${input.name}" as a Draft.`,
            occurredAt,
          });
        }
        if (publishedAt) {
          const label = versionLabel({ major: versionSeed.major, minor: versionSeed.minor });
          await this.ensureHistoryEntry(db, {
            agentId: agent.id,
            agentVersionId: version.id,
            kind: "Published",
            note: `Published ${label}${versionSeed.changeSummary ? `: ${versionSeed.changeSummary}` : ""}.`,
            occurredAt: publishedAt,
          });
        }
      }

      if (isLast) {
        currentVersionId = version.id;
        finalStatus = versionSeed.status;
      }
    }
    if (!currentVersionId) {
      // Unreachable: the empty-versions case is rejected above, so the loop's last iteration
      // always sets this.
      throw new Error(`Cannot seed agent "${input.name}": failed to resolve a current version.`);
    }

    // 3. Current-version pointer + Agent.status + isCurrent flags. Always run — harmlessly
    // idempotent if already correct, and simpler than checking first.
    await db.agentVersion.updateMany({
      where: { agentId: agent.id, id: { not: currentVersionId }, isCurrent: true },
      data: { isCurrent: false, updatedAt: now },
    });
    await db.agentVersion.update({
      where: { id: currentVersionId },
      data: { isCurrent: true, updatedAt: now },
    });
    await db.agent.update({
      where: { id: agent.id },
      data: { currentVersionId, status: finalStatus, updatedAt: now },
    });

    // 4. Channel bindings — current version only (see this file's own module comment).
    await new PrismaAgentBindingsRepository().replaceChannelBindings(
      currentVersionId,
      input.enabledChannelKeys.map((channelKey) => ({ channelKey, isEnabled: true })),
      now,
    );

    return { agentId: agent.id, currentVersionId };
  }

  /** Idempotent per (agentId, agentVersionId, kind) — a re-run never duplicates a history row. */
  private async ensureHistoryEntry(
    db: ReturnType<typeof getTenantDb>,
    entry: {
      readonly agentId: string;
      readonly agentVersionId: string;
      readonly kind: "Created" | "Published";
      readonly note: string;
      readonly occurredAt: Date;
    },
  ): Promise<void> {
    const existing = await db.agentVersionHistoryEntry.findFirst({
      where: { agentId: entry.agentId, agentVersionId: entry.agentVersionId, kind: entry.kind },
    });
    if (existing) return;

    await db.agentVersionHistoryEntry.create({
      data: {
        id: newUlid(entry.occurredAt),
        agentId: entry.agentId,
        agentVersionId: entry.agentVersionId,
        kind: entry.kind,
        note: entry.note,
        fromVersionId: null,
        actorStaffUserId: SYSTEM_SEED_ACTOR_ID,
        occurredAt: entry.occurredAt,
        createdAt: entry.occurredAt,
        updatedAt: entry.occurredAt,
      },
    });
  }
}
