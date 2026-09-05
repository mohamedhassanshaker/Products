import { and, asc, eq, inArray } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { DelegationChainEntry, DelegationOutcomeValue } from "@nextbot/contracts";
import type { FlatDelegationEvent } from "../domain/tree-builder.js";

/**
 * The tree query LLD §14.7.2 describes as "one indexed scan renders the whole
 * tree": every `delegation_event` row for one `agent_run`, ordered by
 * `(depth, sibling_ordinal)` — exactly the index `delegation_event_tenant_run_
 * depth_idx` covers.
 *
 * `agentLabel` is resolved via a second, small query directly against
 * `agent_definition`/`agent_definition_version` (both owned by `agent-platform`)
 * through the shared `@nextbot/db` schema package — reading another module's
 * tables via the shared schema is an already-established pattern in this
 * codebase for a read-only cross-cutting join (distinct from importing that
 * module's own application/domain logic, which the module allow-list governs).
 * **Target Architecture Blueprint Phase 14 (BL-46)**: `memberKey` is now resolved
 * for real. Phase 6 had to leave it `null` because `team_member` did not exist as a
 * table; it does now, so the tree renders the authored member key (`"billing"`)
 * alongside the pinned agent label (`"billing_agent@9"`). This is additive — the
 * contract field was already declared nullable for exactly this reason.
 */
export async function listDelegationEventsForRun(ctx: TenantContext, agentRunId: string): Promise<FlatDelegationEvent[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.delegationEvent)
      .where(and(eq(schema.delegationEvent.tenantId, ctx.tenantId), eq(schema.delegationEvent.agentRunId, agentRunId)))
      .orderBy(asc(schema.delegationEvent.depth), asc(schema.delegationEvent.siblingOrdinal));

    if (rows.length === 0) return [];

    const toolCallsByEvent = await listToolCallIdsByEvent(
      db,
      ctx.tenantId,
      rows.map((r) => r.id),
    );
    const labelByVersionId = await resolveAgentLabels(
      db,
      ctx.tenantId,
      rows.map((r) => r.toAgentVersionId),
    );
    const memberKeyById = await resolveMemberKeys(
      db,
      ctx.tenantId,
      rows.map((r) => r.toMemberId),
    );

    return rows.map((r) => ({
      id: r.id,
      parentDelegationEventId: r.parentDelegationEventId,
      depth: r.depth,
      siblingOrdinal: r.siblingOrdinal,
      agentLabel: labelByVersionId.get(r.toAgentVersionId) ?? r.toAgentVersionId,
      memberKey: memberKeyById.get(r.toMemberId) ?? null,
      reason: r.reason,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pgEnum's inferred TS type is a broader string union than DelegationOutcomeValue would need re-declaring here just to satisfy the compiler for a value already constrained by the DB CHECK/enum.
      outcome: r.outcome as any,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      costUsd: r.costUsd,
      latencyMs: r.latencyMs,
      spanId: r.spanId,
      toolCallIds: toolCallsByEvent.get(r.id) ?? [],
    }));
  });
}

async function listToolCallIdsByEvent(db: TenantScopedClient, tenantId: string, eventIds: string[]): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ id: schema.delegationEvent.id, toolCallId: schema.delegationEvent.toolCallId })
    .from(schema.delegationEvent)
    .where(and(eq(schema.delegationEvent.tenantId, tenantId), inArray(schema.delegationEvent.id, eventIds)));
  const map = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.toolCallId) continue;
    const existing = map.get(row.id) ?? [];
    existing.push(row.toolCallId);
    map.set(row.id, existing);
  }
  return map;
}

/**
 * Phase 14 (BL-46) — the single `"<definitionName>@<version>"` label helper. Used by
 * the delegation executor for every `DelegationChainEntry.agentLabel` (the Approval
 * Queue's chain, the escalation snapshot, the audit `actorLabel`) so those four
 * surfaces and the trace tree all show the SAME string for the same agent version.
 * Falls back to the raw id rather than throwing — a label is presentation, and a
 * missing one must never fail a delegation.
 */
export async function getAgentVersionLabel(ctx: TenantContext, agentDefinitionVersionId: string): Promise<string> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const labels = await resolveAgentLabels(db, ctx.tenantId, [agentDefinitionVersionId]);
    return labels.get(agentDefinitionVersionId) ?? agentDefinitionVersionId;
  });
}

/** Phase 14 (BL-46) — resolves `delegation_event.to_member_id` to the authored
 * `team_member.member_key`, the field Phase 6 had to leave `null`. */
async function resolveMemberKeys(db: TenantScopedClient, tenantId: string, memberIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(memberIds)];
  if (uniqueIds.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.teamMember.id, memberKey: schema.teamMember.memberKey })
    .from(schema.teamMember)
    .where(and(eq(schema.teamMember.tenantId, tenantId), inArray(schema.teamMember.id, uniqueIds)));
  return new Map(rows.map((r) => [r.id, r.memberKey]));
}

async function resolveAgentLabels(db: TenantScopedClient, tenantId: string, versionIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(versionIds)];
  if (uniqueIds.length === 0) return new Map();
  const rows = await db
    .select({
      versionId: schema.agentDefinitionVersion.id,
      version: schema.agentDefinitionVersion.version,
      name: schema.agentDefinition.name,
    })
    .from(schema.agentDefinitionVersion)
    .innerJoin(schema.agentDefinition, eq(schema.agentDefinition.id, schema.agentDefinitionVersion.agentDefinitionId))
    .where(and(eq(schema.agentDefinitionVersion.tenantId, tenantId), inArray(schema.agentDefinitionVersion.id, uniqueIds)));
  return new Map(rows.map((r) => [r.versionId, `${r.name}@${r.version}`]));
}

// ===========================================================================
// Target Architecture Blueprint Phase 14 (BL-46) — the WRITE side. Phase 6 shipped
// this table with no live writer at all; the delegation executor is that writer.
// ===========================================================================

export interface NewDelegationEventInput {
  conversationId: string | null;
  agentRunId: string;
  teamVersionId: string;
  parentDelegationEventId: string | null;
  parentSpanId: string | null;
  spanId: string;
  depth: number;
  siblingOrdinal: number;
  fromAgentVersionId: string;
  fromMemberId: string | null;
  toAgentVersionId: string;
  toMemberId: string;
  toolCallId: string | null;
  reason: string;
  scopeHash: string;
  outcome: DelegationOutcomeValue;
  outcomeDetail: Record<string, unknown> | null;
  fallbackOfEventId: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
  latencyMs: number | null;
  escalationId: string | null;
}

export interface DelegationEventRow extends NewDelegationEventInput {
  id: string;
  tenantId: string;
  createdAt: Date;
}

/**
 * Appends one hop to the delegation trace. Written for EVERY outcome, including
 * `Denied` and `BudgetExceeded` — a hop that never executed is exactly the hop an
 * operator most needs to see in the tree, so a refused delegation is a traced
 * result, never a silent no-op.
 */
export async function insertDelegationEvent(ctx: TenantContext, input: NewDelegationEventInput): Promise<DelegationEventRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .insert(schema.delegationEvent)
      .values({ id: generateId(), tenantId: ctx.tenantId, ...input })
      .returning();
    return rows[0]! as unknown as DelegationEventRow;
  });
}

/**
 * FR-ORC-07's thrash guard input: every payload already delegated TO THIS MEMBER in
 * this run, oldest first. The payload is read back out of `outcome_detail.payloadForThrash`
 * (written by the executor at hand-off time) rather than out of `reason`, because
 * `reason` is the supervisor's ROUTING RATIONALE while the thrash test is about the
 * PAYLOAD — two different strings that a naive implementation would conflate.
 */
export async function listPriorPayloadsToMember(ctx: TenantContext, agentRunId: string, toMemberId: string): Promise<string[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ outcomeDetail: schema.delegationEvent.outcomeDetail, createdAt: schema.delegationEvent.createdAt })
      .from(schema.delegationEvent)
      .where(
        and(
          eq(schema.delegationEvent.tenantId, ctx.tenantId),
          eq(schema.delegationEvent.agentRunId, agentRunId),
          eq(schema.delegationEvent.toMemberId, toMemberId),
        ),
      )
      .orderBy(asc(schema.delegationEvent.createdAt));
    return rows.map((r) => {
      const detail = r.outcomeDetail as { payloadForThrash?: unknown } | null;
      return typeof detail?.payloadForThrash === "string" ? detail.payloadForThrash : "";
    });
  });
}

/** FR-ORC-07 — the run's real consumption so far, fed straight into
 * `evaluateOrDeny`'s `consumed` so ITS step-2 ceilings are the enforcement (rather
 * than this module re-deriving a second set of comparisons). */
export async function summarizeRunConsumption(
  ctx: TenantContext,
  agentRunId: string,
): Promise<{ usd: number; delegations: number; maxDepth: number; fanOutByParent: Map<string, number> }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({
        costUsd: schema.delegationEvent.costUsd,
        depth: schema.delegationEvent.depth,
        parentId: schema.delegationEvent.parentDelegationEventId,
      })
      .from(schema.delegationEvent)
      .where(and(eq(schema.delegationEvent.tenantId, ctx.tenantId), eq(schema.delegationEvent.agentRunId, agentRunId)));

    let usd = 0;
    let maxDepth = 0;
    const fanOutByParent = new Map<string, number>();
    for (const row of rows) {
      usd += Number(row.costUsd ?? 0);
      if (row.depth > maxDepth) maxDepth = row.depth;
      const key = row.parentId ?? "__root__";
      fanOutByParent.set(key, (fanOutByParent.get(key) ?? 0) + 1);
    }
    return { usd, delegations: rows.length, maxDepth, fanOutByParent };
  });
}

/**
 * FR-ORC-04/06/08 — reconstructs the delegation chain for a run from the persisted
 * events, root-first. Used by the escalation snapshot and by the Approval Queue's
 * "show me the chain for an already-recorded run" read path. The chain the Approval
 * Queue snapshots at SUSPENSION time comes from the executor's own live chain
 * instead (see `orchestration`'s `ToolCallDelegationContext` doc for why).
 */
export async function buildDelegationChainForRun(ctx: TenantContext, agentRunId: string): Promise<DelegationChainEntry[]> {
  const events = await listDelegationEventsForRun(ctx, agentRunId);
  return events.map((e) => ({
    depth: e.depth,
    agentLabel: e.agentLabel,
    memberKey: e.memberKey,
    reason: e.reason,
    outcome: e.outcome,
  }));
}

/** FR-ORC-11 — which of `memberIds` the given run never delegated to. An empty
 * result means the run exercised the WHOLE topology; anything else fails the
 * promotion gate (a supervisor-only run returns every member key). */
export async function listMemberIdsDelegatedInRun(ctx: TenantContext, agentRunId: string): Promise<Set<string>> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ toMemberId: schema.delegationEvent.toMemberId })
      .from(schema.delegationEvent)
      .where(and(eq(schema.delegationEvent.tenantId, ctx.tenantId), eq(schema.delegationEvent.agentRunId, agentRunId)));
    return new Set(rows.map((r) => r.toMemberId));
  });
}
