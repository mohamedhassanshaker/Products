import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, withTenant, type TenantContext } from "@nextbot/db";
import type { DelegationChainEntry, ScopeDescriptor, TeamLimits, TeamMemberSpec } from "@nextbot/contracts";
import { getTenantScopePolicy } from "@nextbot/authz";
import { startAgentRun } from "@nextbot/agent-platform";
import { attachDelegationContextToEscalation, triggerEscalation } from "@nextbot/escalations";
import { insertMessage } from "@nextbot/conversations";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createFixtureAgentVersion, createFixtureConversation, createFixtureRoute, teamArtifact } from "../testing/team-fixtures.js";
import { createTeamWithFirstVersion } from "./team-service.js";
import { delegate, type DelegationRunState } from "./delegation-executor.js";
import { getAgentVersionLabel, buildDelegationChainForRun } from "../infrastructure/delegation-event-repository.js";
import { listTeamMembers, type TeamMemberRow, type TeamVersionRow } from "../infrastructure/team-repository.js";
import type { EscalationSink } from "../ports/escalation-sink.js";
import type { SpecialistRunner } from "../ports/specialist-runner.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46) — the three CHAIN-propagation
 * requirements plus §14.7.4's internal-only routing guarantee:
 *
 *  - **FR-ORC internal-only routing (LLD §14.7.4)**: a multi-hop run's `message`
 *    rows are BYTE-IDENTICAL to a single-agent equivalent's. Delegation adds no
 *    `MessageContentType`, no `message` row, and no SSE event.
 *  - **FR-ORC-06**: one conversation raises exactly ONE active `Escalation` even
 *    when several members trip an escalation in the same run, and that record
 *    carries the whole chain.
 *  - **FR-ORC-08**: the audit entry for a delegated action is attributed
 *    `agent:<label>` with the chain in `detail` — and the `actor` COLUMN shape is
 *    unchanged, so an existing audit query still works.
 */
const AUTHOR = "11111111-1111-1111-1111-111111111111";
let mockModel: MockOpenAiServerHandle;

function memberSpec(key: string, pin: string, overrides: Partial<TeamMemberSpec> = {}): TeamMemberSpec {
  return { key, agent: pin, delegationTier: "Tier1", invokeWhen: `about ${key}`, fallbackAction: "Escalate", ...overrides };
}

const answeringRunner: SpecialistRunner = {
  async run() {
    return { outcome: "answered", text: "handled", tokensIn: 1, tokensOut: 1, costUsd: "0" };
  },
};
const escalatingRunner: SpecialistRunner = {
  async run() {
    return { outcome: "escalate", text: "needs a human", tokensIn: 1, tokensOut: 1, costUsd: "0" };
  },
};

async function buildRunState(
  ctx: TenantContext,
  teamVersion: TeamVersionRow,
  members: TeamMemberRow[],
  supervisorVersionId: string,
  conversationId: string | null,
): Promise<DelegationRunState> {
  const { run } = await startAgentRun(ctx, {
    agentDefinitionVersionId: supervisorVersionId,
    trigger: "CustomerMessage",
    ...(conversationId ? { conversationId } : {}),
  });
  const supervisorLabel = await getAgentVersionLabel(ctx, supervisorVersionId);
  return {
    agentRunId: run.id,
    conversationId,
    teamVersion,
    limits: teamVersion.limitsJson as TeamLimits,
    tenantPolicy: await getTenantScopePolicy(ctx),
    supervisorVersionId,
    supervisorLabel,
    membersById: new Map(members.map((m) => [m.id, m])),
    startedAtMs: Date.now(),
    consumed: { usd: 0, steps: 0, delegations: 0 },
    fanOutByParent: new Map(),
    chain: [{ depth: 0, agentLabel: supervisorLabel, memberKey: null, reason: "Team supervisor (routing)", outcome: null }],
  };
}

function rootHop(state: DelegationRunState, siblingOrdinal = 0) {
  return {
    depth: 1,
    siblingOrdinal,
    parentEventId: null,
    parentSpanId: null,
    fromMemberId: null,
    fromAgentVersionId: state.supervisorVersionId,
    fromScopeChain: [state.teamVersion.scopeJson as ScopeDescriptor],
  };
}

async function teamFixture(createdTenantIds: string[]) {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  const supervisor = await createFixtureAgentVersion(ctx, "triage");
  const billing = await createFixtureAgentVersion(ctx, "billing_agent");
  const shipping = await createFixtureAgentVersion(ctx, "shipping_agent");
  const route = await createFixtureRoute(ctx, mockModel.url);
  const created = await createTeamWithFirstVersion(
    ctx,
    {
      name: "support_team",
      artifact: teamArtifact("support_team", supervisor.pin, route.name, [memberSpec("billing", billing.pin), memberSpec("shipping", shipping.pin)]),
    },
    AUTHOR,
  );
  return { ctx, supervisor, version: created.version, members: await listTeamMembers(ctx, created.version.id) };
}

/** Every `message` row for a conversation, in sequence order, with the volatile
 * per-row identity/timestamp columns stripped — what "byte-identical" means for a
 * comparison across two different conversations. */
async function messageShapes(ctx: TenantContext, conversationId: string) {
  return withTenant(ctx, async (db) => {
    const rows = await db
      .select()
      .from(schema.message)
      .where(and(eq(schema.message.tenantId, ctx.tenantId), eq(schema.message.conversationId, conversationId)))
      .orderBy(asc(schema.message.sequence));
    return rows.map((r) => ({ sequence: r.sequence, sender: r.sender, contentType: r.contentType, payload: r.payload }));
  });
}

describe("LLD §14.7.4 — delegation is INTERNAL-ONLY and adds nothing customer-visible", () => {
  const createdTenantIds: string[] = [];
  beforeAll(async () => {
    mockModel = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "{}" }) });
  });
  afterAll(async () => {
    await mockModel.close();
  });
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a multi-hop run's `message` rows are BYTE-IDENTICAL to the single-agent equivalent's", async () => {
    const f = await teamFixture(createdTenantIds);

    // Both conversations get the IDENTICAL customer question and AI reply, so the
    // comparison is over real, non-empty transcripts rather than two empty ones.
    const turn = async (conversationId: string) => {
      await insertMessage(f.ctx, { conversationId, sender: "Customer", contentType: "Text", payload: { contentType: "Text", text: "refund my invoice" } });
      await insertMessage(f.ctx, { conversationId, sender: "AI", contentType: "Text", payload: { contentType: "Text", text: "handled" } });
    };

    // Conversation A: a single-agent turn — no delegation at all.
    const singleAgentConversation = await createFixtureConversation(f.ctx);
    await turn(singleAgentConversation);

    // Conversation B: the same turn, PLUS a real multi-hop delegation run.
    const delegatedConversation = await createFixtureConversation(f.ctx);
    await turn(delegatedConversation);
    const state = await buildRunState(f.ctx, f.version, f.members, f.supervisor.versionId, delegatedConversation);
    await delegate(f.ctx, { specialistRunner: answeringRunner }, state, rootHop(state, 0), f.members[0]!, "refund my invoice", "billing");
    await delegate(f.ctx, { specialistRunner: answeringRunner }, state, rootHop(state, 1), f.members[1]!, "where is my parcel", "shipping");

    // The delegation really happened…
    const events = await buildDelegationChainForRun(f.ctx, state.agentRunId);
    expect(events).toHaveLength(2);

    // …and produced ZERO customer-visible messages, so the two conversations'
    // transcripts are indistinguishable.
    const delegatedShapes = await messageShapes(f.ctx, delegatedConversation);
    expect(delegatedShapes).toEqual(await messageShapes(f.ctx, singleAgentConversation));
    // Exactly the two turn messages — delegation added no third row, no new
    // content type, and nothing naming a member or a routing rationale.
    expect(delegatedShapes).toHaveLength(2);
    expect(JSON.stringify(delegatedShapes)).not.toContain("billing");
    expect(JSON.stringify(delegatedShapes)).not.toContain("shipping");
  });

  it("`delegation_event.reason` (the supervisor's rationale) never appears in any message row", async () => {
    const f = await teamFixture(createdTenantIds);
    const conversationId = await createFixtureConversation(f.ctx);
    const state = await buildRunState(f.ctx, f.version, f.members, f.supervisor.versionId, conversationId);
    const SECRET_RATIONALE = "internal-routing-rationale-that-must-never-be-customer-visible";
    await delegate(f.ctx, { specialistRunner: answeringRunner }, state, rootHop(state), f.members[0]!, "refund", SECRET_RATIONALE);

    const chain = await buildDelegationChainForRun(f.ctx, state.agentRunId);
    expect(chain[0]?.reason).toBe(SECRET_RATIONALE);
    expect(JSON.stringify(await messageShapes(f.ctx, conversationId))).not.toContain(SECRET_RATIONALE);
  });
});

describe("FR-ORC-06 — one conversation, exactly ONE active escalation, carrying the full chain", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  /** The REAL composition-root sink: `escalations`' own create-or-attach service,
   * then the delegation-context attach. Duplicated here rather than imported from
   * `apps/web` because a module's test cannot depend on an app; it is the same six
   * lines, and the guarantee under test belongs to `escalations` either way. */
  function realSink(ctx: TenantContext): EscalationSink {
    return {
      async escalate(request) {
        const { escalation, created } = await triggerEscalation(ctx, {
          conversationId: request.conversationId,
          reason: request.reason,
          reasonDetail: request.reasonDetail,
          aiContextSnapshot: request.aiContextSnapshot,
        });
        await attachDelegationContextToEscalation(ctx, escalation.id, {
          delegationRunId: request.delegationRunId,
          delegationChain: request.delegationChain,
        });
        return { escalationId: escalation.id, created };
      },
    };
  }

  it("two members escalating in the SAME run produce ONE escalation row, with the longest chain attached", async () => {
    const f = await teamFixture(createdTenantIds);
    const conversationId = await createFixtureConversation(f.ctx);
    const state = await buildRunState(f.ctx, f.version, f.members, f.supervisor.versionId, conversationId);
    const sink = realSink(f.ctx);

    const first = await delegate(f.ctx, { specialistRunner: escalatingRunner, escalationSink: sink }, state, rootHop(state, 0), f.members[0]!, "refund my invoice", "billing");
    const second = await delegate(f.ctx, { specialistRunner: escalatingRunner, escalationSink: sink }, state, rootHop(state, 1), f.members[1]!, "where is my parcel", "shipping");

    expect(first.outcome).toBe("Escalated");
    expect(second.outcome).toBe("Escalated");
    // The SAME escalation — `escalations`' own partial unique index is what
    // guarantees this, reused rather than re-derived.
    expect(second.escalationId).toBe(first.escalationId);

    const escalations = await withTenant(f.ctx, (db) =>
      db.select().from(schema.escalation).where(and(eq(schema.escalation.tenantId, f.ctx.tenantId), eq(schema.escalation.conversationId, conversationId))),
    );
    expect(escalations).toHaveLength(1);
    expect(escalations[0]?.delegationRunId).toBe(state.agentRunId);

    // …and the record carries the WHOLE chain (supervisor + both hops), which is
    // what the takeover panel renders as a tree.
    const snapshot = escalations[0]?.aiContextSnapshot as { delegationChain?: DelegationChainEntry[] };
    expect(snapshot.delegationChain).toBeDefined();
    expect(snapshot.delegationChain!.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.delegationChain!.map((c) => c.memberKey)).toContain("billing");
    expect(snapshot.delegationChain!.map((c) => c.memberKey)).toContain("shipping");
    expect(snapshot.delegationChain![0]?.memberKey).toBeNull(); // the supervisor
  });
});

describe("FR-ORC-08 — a delegated tool call emits the audit-shaped outbox payload (actor + chain + correlation id)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  /**
   * `audit` is deliberately not a permitted import target for ANY module (LLD §2.3:
   * "every other module reaches them only via domain events, never a direct
   * import"), so this suite asserts the OUTBOX payload — the actual contract
   * between this phase and the audit log. The other half (that `audit`'s mapper
   * turns this payload into an `actor`-column-shape-preserving entry, and that a
   * pre-existing audit query still works) is asserted inside `audit`'s own suite,
   * `sync-audit-from-events.delegation.int.test.ts`.
   */
  it("emits `actorLabel: agent:<terminal label>`, the full chain, and the run's correlation id — and NOTHING for a non-delegated call", async () => {
    const { createSuspendedToolCall } = await import("@nextbot/orchestration");
    const f = await teamFixture(createdTenantIds);
    const conversationId = await createFixtureConversation(f.ctx);
    const state = await buildRunState(f.ctx, f.version, f.members, f.supervisor.versionId, conversationId);

    // Baseline: a NON-delegated Tier-3 suspension keeps its exact prior payload.
    await createSuspendedToolCall(f.ctx, {
      conversationId,
      toolId: f.members[0]!.toolId,
      toolName: "plain_tool",
      connectorId: null,
      args: {},
      tier: "Tier3",
    });

    const chain: DelegationChainEntry[] = [
      { depth: 0, agentLabel: "triage@1.0.0", memberKey: null, reason: "supervisor", outcome: null },
      { depth: 1, agentLabel: "billing_agent@1.0.0", memberKey: "billing", reason: "billing question", outcome: null },
    ];
    await createSuspendedToolCall(f.ctx, {
      conversationId,
      toolId: f.members[1]!.toolId,
      toolName: "delegated_tool",
      connectorId: null,
      args: {},
      tier: "Tier3",
      delegation: { agentRunId: state.agentRunId, chain },
    });

    const events = await withTenant(f.ctx, (db) =>
      db
        .select()
        .from(schema.domainEvent)
        .where(and(eq(schema.domainEvent.tenantId, f.ctx.tenantId), eq(schema.domainEvent.type, "orchestration.tool_call.awaiting_human_approval"))),
    );
    const plain = events.find((e) => (e.payload as { toolName?: string }).toolName === "plain_tool")!;
    const delegated = events.find((e) => (e.payload as { toolName?: string }).toolName === "delegated_tool")!;

    // Unchanged for a non-delegated call — the audit mapper falls back to "system",
    // exactly as it always did, so no existing audit query changes meaning.
    expect((plain.payload as Record<string, unknown>).actorLabel).toBeUndefined();
    expect((plain.payload as Record<string, unknown>).delegationChain).toBeUndefined();

    const payload = delegated.payload as { actorLabel?: string; delegationChain?: DelegationChainEntry[]; correlationId?: string; targetType?: string; targetId?: string };
    // Attributed to the TERMINAL agent, in the `actor` column's EXISTING text shape —
    // the chain itself lives in `detail`, never in a new column.
    expect(payload.actorLabel).toBe("agent:billing_agent@1.0.0");
    expect(payload.delegationChain?.map((c) => c.agentLabel)).toEqual(["triage@1.0.0", "billing_agent@1.0.0"]);
    expect(payload.correlationId).toBe(state.agentRunId);
    expect(payload.targetType).toBe("tool_call");
    expect(typeof payload.targetId).toBe("string");
  });
});
