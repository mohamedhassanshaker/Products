import { and, asc, eq, max } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { TeamStatusValue, TeamVersionStatusValue } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, LLD §14.7.2) — persistence for
 * `team` / `team_version` / `team_member`.
 *
 * **Immutability, layer 1 of 3.** This file deliberately exposes no generic
 * `updateTeamVersion`/`updateTeamMember`. `team_version` can only be created, and
 * then have its promotion-ladder bookkeeping columns set through the narrow
 * `setTeamVersionStatus`/`bindTeamVersionSandboxRun` functions; `team_member` cannot
 * be updated at all. Layer 2 is migration `0076`'s `team_version_immutable` /
 * `team_member_immutable` BEFORE UPDATE triggers (so even raw SQL cannot bypass
 * layer 1); layer 3 is `teams.immutability.int.test.ts`.
 */

export interface TeamRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: TeamStatusValue;
  currentVersionId: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamVersionRow {
  id: string;
  tenantId: string;
  teamId: string;
  version: number;
  yaml: string;
  yamlHash: string;
  supervisorDefinitionVersionId: string;
  supervisorRouteVersionId: string;
  limitsJson: unknown;
  failureMode: "Escalate";
  scopeJson: unknown;
  status: TeamVersionStatusValue;
  evalSuiteId: string | null;
  lastEvalRunId: string | null;
  sandboxRunId: string | null;
  createdByUserId: string;
  approvedByUserId: string | null;
  createdAt: Date;
}

export interface TeamMemberRow {
  id: string;
  tenantId: string;
  teamVersionId: string;
  definitionVersionId: string;
  toolId: string;
  memberKey: string;
  delegationTier: "Tier1" | "Tier2" | "Tier3";
  invokeWhen: string;
  scopeJson: unknown;
  fallbackMemberId: string | null;
  fallbackAction: "Member" | "Escalate";
  ordinal: number;
  createdAt: Date;
}

/** One member row to insert, with its fallback still expressed by KEY — the
 * repository resolves keys to ids inside the transaction, which is only safe
 * because `team_member_fallback_member_id_fkey` is DEFERRABLE INITIALLY DEFERRED
 * (migration `0076`): a member may point at a later-ordinal sibling. */
export interface NewTeamMemberInput {
  memberKey: string;
  definitionVersionId: string;
  toolId: string;
  delegationTier: "Tier1" | "Tier2" | "Tier3";
  invokeWhen: string;
  scopeJson: unknown;
  fallbackAction: "Member" | "Escalate";
  fallbackMemberKey: string | null;
  ordinal: number;
}

export interface NewTeamVersionInput {
  teamId: string;
  version: number;
  yaml: string;
  yamlHash: string;
  supervisorDefinitionVersionId: string;
  supervisorRouteVersionId: string;
  limitsJson: unknown;
  scopeJson: unknown;
  createdByUserId: string;
  members: NewTeamMemberInput[];
  /** Callback invoked with the not-yet-persisted `team_version.id` so the caller can
   * stamp it into each member's `scope_json.originId`/the version's own
   * `scope_json.originId` before the row is written. Keeps id generation in one
   * place without forcing the caller to pre-generate uuids. */
  finalizeScopes?: (teamVersionId: string, memberIdsByKey: Map<string, string>) => { versionScope: unknown; memberScopes: Map<string, unknown> };
}

export async function createTeam(
  ctx: TenantContext,
  input: { name: string; description: string | null; createdByUserId: string },
): Promise<TeamRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .insert(schema.team)
      .values({
        id: generateId(),
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description,
        createdByUserId: input.createdByUserId,
      })
      .returning();
    return rows[0]! as TeamRow;
  });
}

export async function listTeams(ctx: TenantContext): Promise<TeamRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.team).where(eq(schema.team.tenantId, ctx.tenantId)).orderBy(asc(schema.team.name));
    return rows as TeamRow[];
  });
}

export async function findTeamById(ctx: TenantContext, id: string): Promise<TeamRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.team).where(and(eq(schema.team.tenantId, ctx.tenantId), eq(schema.team.id, id)));
    return (rows[0] as TeamRow | undefined) ?? null;
  });
}

export async function findTeamByName(ctx: TenantContext, name: string): Promise<TeamRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.team).where(and(eq(schema.team.tenantId, ctx.tenantId), eq(schema.team.name, name)));
    return (rows[0] as TeamRow | undefined) ?? null;
  });
}

export async function updateTeamMetadata(
  ctx: TenantContext,
  id: string,
  patch: { description?: string | null; status?: TeamStatusValue },
): Promise<TeamRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .update(schema.team)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(schema.team.tenantId, ctx.tenantId), eq(schema.team.id, id)))
      .returning();
    return (rows[0] as TeamRow | undefined) ?? null;
  });
}

/** The next monotonic version ordinal for a team. Read inside the SAME transaction
 * that inserts, so two concurrent creates cannot both compute `N+1` and silently
 * lose one — the loser hits `team_version_tenant_team_version_key` and fails
 * loudly, which is the correct outcome for an immutable-version artifact. */
async function nextVersionOrdinal(db: TenantScopedClient, tenantId: string, teamId: string): Promise<number> {
  const rows = await db
    .select({ current: max(schema.teamVersion.version) })
    .from(schema.teamVersion)
    .where(and(eq(schema.teamVersion.tenantId, tenantId), eq(schema.teamVersion.teamId, teamId)));
  return (rows[0]?.current ?? 0) + 1;
}

/**
 * Inserts a `team_version` plus its whole member set in one transaction.
 *
 * `failure_mode` is passed explicitly and always — the column has NO DEFAULT
 * (FR-ORC-03's literal enforcement), so this is the only way a row can exist.
 */
export async function insertTeamVersion(
  ctx: TenantContext,
  input: Omit<NewTeamVersionInput, "version"> & { version?: number },
): Promise<{ version: TeamVersionRow; members: TeamMemberRow[] }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const version = input.version ?? (await nextVersionOrdinal(db, ctx.tenantId, input.teamId));
    const versionId = generateId();
    const memberIdsByKey = new Map(input.members.map((m) => [m.memberKey, generateId()]));

    const finalized = input.finalizeScopes?.(versionId, memberIdsByKey);
    const versionScope = finalized?.versionScope ?? input.scopeJson;

    const versionRows = await db
      .insert(schema.teamVersion)
      .values({
        id: versionId,
        tenantId: ctx.tenantId,
        teamId: input.teamId,
        version,
        yaml: input.yaml,
        yamlHash: input.yamlHash,
        supervisorDefinitionVersionId: input.supervisorDefinitionVersionId,
        supervisorRouteVersionId: input.supervisorRouteVersionId,
        limitsJson: input.limitsJson,
        failureMode: "Escalate",
        scopeJson: versionScope,
        createdByUserId: input.createdByUserId,
      })
      .returning();

    const memberRows: TeamMemberRow[] = [];
    for (const member of input.members) {
      const rows = await db
        .insert(schema.teamMember)
        .values({
          id: memberIdsByKey.get(member.memberKey)!,
          tenantId: ctx.tenantId,
          teamVersionId: versionId,
          definitionVersionId: member.definitionVersionId,
          toolId: member.toolId,
          memberKey: member.memberKey,
          delegationTier: member.delegationTier,
          invokeWhen: member.invokeWhen,
          scopeJson: finalized?.memberScopes.get(member.memberKey) ?? member.scopeJson,
          fallbackAction: member.fallbackAction,
          fallbackMemberId: member.fallbackMemberKey ? (memberIdsByKey.get(member.fallbackMemberKey) ?? null) : null,
          ordinal: member.ordinal,
        })
        .returning();
      memberRows.push(rows[0]! as TeamMemberRow);
    }

    return { version: versionRows[0]! as TeamVersionRow, members: memberRows };
  });
}

export async function listTeamVersions(ctx: TenantContext, teamId: string): Promise<TeamVersionRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.teamVersion)
      .where(and(eq(schema.teamVersion.tenantId, ctx.tenantId), eq(schema.teamVersion.teamId, teamId)))
      .orderBy(asc(schema.teamVersion.version));
    return rows as TeamVersionRow[];
  });
}

export async function findTeamVersionById(ctx: TenantContext, id: string): Promise<TeamVersionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.teamVersion)
      .where(and(eq(schema.teamVersion.tenantId, ctx.tenantId), eq(schema.teamVersion.id, id)));
    return (rows[0] as TeamVersionRow | undefined) ?? null;
  });
}

export async function listTeamMembers(ctx: TenantContext, teamVersionId: string): Promise<TeamMemberRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.teamMember)
      .where(and(eq(schema.teamMember.tenantId, ctx.tenantId), eq(schema.teamMember.teamVersionId, teamVersionId)))
      .orderBy(asc(schema.teamMember.ordinal));
    return rows as TeamMemberRow[];
  });
}

/** The ONLY status-mutating path (immutability layer 1). `approvedByUserId` is
 * written in the same statement as the `Approved` status so the DB's
 * `team_version_approver_distinct` CHECK evaluates against the real pair. */
export async function setTeamVersionStatus(
  ctx: TenantContext,
  id: string,
  status: TeamVersionStatusValue,
  approvedByUserId?: string | null,
): Promise<TeamVersionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .update(schema.teamVersion)
      .set({ status, ...(approvedByUserId !== undefined ? { approvedByUserId } : {}) })
      .where(and(eq(schema.teamVersion.tenantId, ctx.tenantId), eq(schema.teamVersion.id, id)))
      .returning();
    return (rows[0] as TeamVersionRow | undefined) ?? null;
  });
}

/** FR-ORC-11 — records which sandbox run exercised this version. Separate from
 * `setTeamVersionStatus` because a sandbox run happens while the version is still a
 * Draft, long before any promotion attempt. */
export async function bindTeamVersionSandboxRun(ctx: TenantContext, id: string, sandboxRunId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.teamVersion)
      .set({ sandboxRunId })
      .where(and(eq(schema.teamVersion.tenantId, ctx.tenantId), eq(schema.teamVersion.id, id)));
  });
}

export async function setTeamCurrentVersion(ctx: TenantContext, teamId: string, versionId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.team)
      .set({ currentVersionId: versionId, updatedAt: new Date() })
      .where(and(eq(schema.team.tenantId, ctx.tenantId), eq(schema.team.id, teamId)));
  });
}
