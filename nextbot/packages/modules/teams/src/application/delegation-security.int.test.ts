import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, withTenant, type TenantContext } from "@nextbot/db";
import type { DelegationChainEntry, ScopeDescriptor, TeamLimits, TeamMemberSpec } from "@nextbot/contracts";
import { getTenantScopePolicy } from "@nextbot/authz";
import { startAgentRun } from "@nextbot/agent-platform";
import { createConnector } from "@nextbot/connectors";
import { setPiiPolicy } from "@nextbot/pii";
import { updateToolRules, upsertToolFromDiscovery } from "@nextbot/tool-registry";
import type { EgressPort } from "@nextbot/orchestration";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createFixtureAgentVersion, createFixtureConversation, createFixtureRoute, teamArtifact } from "../testing/team-fixtures.js";
import { createTeamWithFirstVersion } from "./team-service.js";
import { delegate, type DelegationRunState } from "./delegation-executor.js";
import { createTurnPipelineSpecialistRunner } from "../infrastructure/turn-pipeline-specialist-runner.js";
import { getAgentVersionLabel, listDelegationEventsForRun } from "../infrastructure/delegation-event-repository.js";
import { listTeamMembers, type TeamMemberRow, type TeamVersionRow } from "../infrastructure/team-repository.js";
import type { SpecialistRunner } from "../ports/specialist-runner.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46) — **the adversarial verification
 * this phase's own exit gate requires**: "a Tier-3 requirement is never bypassed by
 * crossing a delegation hop, and the permission intersection at each hop is the
 * Phase 6 evaluator's real output, not a second independently-derived check."
 *
 * Everything here runs against real Postgres, the real Phase 6 evaluator, the real
 * `@nextbot/pii` masker and — for the Tier-3 case — the REAL production specialist
 * runner (orchestration's turn pipeline) driven by a mock OpenAI-compatible model
 * server. Nothing in the authorisation path is stubbed.
 */
const AUTHOR = "11111111-1111-1111-1111-111111111111";

/** Set per test; the mock model answers goal-selection from this table, keyed by the
 * incoming user message so each hop in a multi-hop run can be scripted distinctly. */
let goalSelectionByTask: Record<string, unknown> = {};
let modelServer: MockOpenAiServerHandle;

/** An egress port that FAILS LOUDLY if anything tries to dispatch a tool. A Tier-3
 * call must suspend into the Approval Queue, never reach a backend — so a call here
 * is itself the defect the suite is looking for. */
const forbiddenEgress: EgressPort = {
  async invokeTool() {
    throw new Error("SECURITY DEFECT: a tool was dispatched to egress instead of suspending for approval");
  },
};

function memberSpec(key: string, pin: string, overrides: Partial<TeamMemberSpec> = {}): TeamMemberSpec {
  return { key, agent: pin, delegationTier: "Tier1", invokeWhen: `about ${key}`, fallbackAction: "Escalate", ...overrides };
}

async function buildRunState(
  ctx: TenantContext,
  teamVersion: TeamVersionRow,
  members: TeamMemberRow[],
  supervisorVersionId: string,
  conversationId: string | null,
): Promise<DelegationRunState> {
  const { run } = await startAgentRun(ctx, {
    agentDefinitionVersionId: supervisorVersionId,
    trigger: "SandboxTest",
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

function rootHop(state: DelegationRunState) {
  return {
    depth: 1,
    siblingOrdinal: 0,
    parentEventId: null,
    parentSpanId: null,
    fromMemberId: null,
    fromAgentVersionId: state.supervisorVersionId,
    fromScopeChain: [state.teamVersion.scopeJson as ScopeDescriptor],
  };
}

describe("ADVERSARIAL 1 — a Tier-3 requirement is never bypassed by crossing a delegation hop (FR-ORC-04)", () => {
  const createdTenantIds: string[] = [];
  beforeAll(async () => {
    modelServer = await startMockOpenAiCompatibleServer({
      onChatCompletion: (body) => {
        const lastUser = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";
        const scripted = goalSelectionByTask[lastUser];
        return { content: JSON.stringify(scripted ?? { action: "reply", replyText: "ok", confidence: 0.95 }) };
      },
    });
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_BASE_URL = modelServer.url;
    process.env.AI_MODEL_REASONING_PLANNER = "planner-test-model";
    process.env.AI_MODEL_CHAT_PRIMARY = "planner-test-model";
  });
  afterAll(async () => {
    await modelServer.close();
    delete process.env.AI_PROVIDER;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL_REASONING_PLANNER;
    delete process.env.AI_MODEL_CHAT_PRIMARY;
  });
  afterEach(async () => {
    goalSelectionByTask = {};
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
    vi.restoreAllMocks();
  });

  it("a real supervisor -> specialist -> specialist run whose DEEPEST hop makes a Tier-3 tool call stops at the Approval Queue with the FULL chain", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    // A REAL Tier-3 MCP tool.
    const connector = await createConnector(ctx, {
      name: "Billing",
      backendType: "Billing",
      transport: "StreamableHTTP",
      endpointUrl: "https://billing.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    await withTenant(ctx, (db) => db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connector.id)));
    // The tool's OWN classification is Tier-1; the tenant's permission rule is what
    // makes it require Tier-3 human approval. This is the sharp version of
    // FR-ORC-04: every delegation hop on the way down looks cheap (the agent-as-tool
    // tier floor derives Tier-1 from the tool's own classification), yet the terminal
    // call still must stop for a human. A configuration an admin can genuinely
    // create — "this lookup is Tier-1 in general, but Tier-3 in MY tenant".
    const refund = await upsertToolFromDiscovery(ctx, {
      connectorId: connector.id,
      name: "issue_refund",
      descriptionSource: "Issues a refund",
      rwClass: "Write",
      approvalTier: "Tier1",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    });
    await updateToolRules(ctx, refund.toolId, [
      { scope: "Tool", toolId: refund.toolId, ordinal: 0, conditions: {}, effect: "RequireApproval", requiredTier: "Tier3", enabled: true },
    ]);

    const supervisor = await createFixtureAgentVersion(ctx, "triage");
    const middle = await createFixtureAgentVersion(ctx, "billing_agent");
    const deep = await createFixtureAgentVersion(ctx, "refund_agent");
    const route = await createFixtureRoute(ctx, modelServer.url);

    const created = await createTeamWithFirstVersion(
      ctx,
      {
        name: "support_team",
        artifact: teamArtifact("support_team", supervisor.pin, route.name, [memberSpec("billing", middle.pin), memberSpec("refunds", deep.pin)]),
      },
      AUTHOR,
    );
    const members = await listTeamMembers(ctx, created.version.id);
    const refundsMember = members.find((m) => m.memberKey === "refunds")!;
    const billingMember = members.find((m) => m.memberKey === "billing")!;

    const MIDDLE_TASK = "the customer wants their invoice refunded";
    const DEEP_TASK = "process the refund now";
    // Hop 2 (the middle specialist) sub-delegates to `refunds` by selecting its
    // AgentAsTool catalog entry — a genuine production path, not a test shortcut.
    goalSelectionByTask[MIDDLE_TASK] = { action: "call_tool", toolName: refundsMember.toolId, args: { task: DEEP_TASK }, confidence: 0.95 };
    // Hop 3 (the deepest specialist) makes the Tier-3 tool call.
    goalSelectionByTask[DEEP_TASK] = { action: "call_tool", toolName: refund.toolId, args: { amount: 100 }, confidence: 0.95 };

    const conversationId = await createFixtureConversation(ctx);
    const state = await buildRunState(ctx, created.version, members, supervisor.versionId, conversationId);
    // THE REAL PRODUCTION RUNNER — orchestration's own turn pipeline.
    const runner = createTurnPipelineSpecialistRunner(ctx, { egress: forbiddenEgress });

    await delegate(ctx, { specialistRunner: runner }, state, rootHop(state), billingMember, MIDDLE_TASK, "billing question");

    // --- The Tier-3 call reached the Approval Queue -------------------------
    const approvals = await withTenant(ctx, (db) =>
      db.select().from(schema.approvalRequest).where(eq(schema.approvalRequest.tenantId, ctx.tenantId)),
    );
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.status).toBe("AwaitingHumanApproval");

    const toolCalls = await withTenant(ctx, (db) => db.select().from(schema.toolCall).where(eq(schema.toolCall.tenantId, ctx.tenantId)));
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.approvalTier).toBe("Tier3");
    expect(toolCalls[0]?.toolName).toBe("issue_refund");
    expect(toolCalls[0]?.status).toBe("AwaitingHumanApproval");
    // The run this happened inside is recorded, so the queue can link to the tree.
    expect(toolCalls[0]?.agentRunId).toBe(state.agentRunId);

    // --- …carrying the FULL chain, not just the terminal agent (FR-ORC-04) ---
    const chain = (approvals[0]?.riskSummary as { delegationChain?: DelegationChainEntry[] }).delegationChain;
    expect(chain).toBeDefined();
    const labels = chain!.map((c) => c.agentLabel);
    expect(labels).toContain("triage@1.0.0");
    expect(labels).toContain("billing_agent@1.0.0");
    expect(labels).toContain("refund_agent@1.0.0");
    // The terminal agent is LAST, and its delegating parent is visibly above it —
    // "billing_agent@9, delegated by triage@14", not a bare terminal name.
    expect(labels[labels.length - 1]).toBe("refund_agent@1.0.0");
    expect(chain!.map((c) => c.depth)).toEqual([0, 1, 2]);

    // --- and it genuinely NEVER dispatched (the forbidden egress never threw) ---
    const events = await listDelegationEventsForRun(ctx, state.agentRunId);
    expect(events.map((e) => e.memberKey)).toEqual(["billing", "refunds"]);
  }, 60_000);
});

describe("ADVERSARIAL 2 — the permission check at each hop is a REAL call into the Phase 6 evaluator", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
    vi.restoreAllMocks();
  });

  it("spies on `@nextbot/authz`'s own module export and proves `evaluateOrDeny` fires once per hop with the real chain", async () => {
    // Same technique Phase 12 used to prove Studio calls the single validator: spy
    // on the module export object itself, so a second hand-rolled comparison inside
    // the executor would leave the spy uncalled and fail this test.
    const authz = await import("@nextbot/authz");
    const spy = vi.spyOn(authz, "evaluateOrDeny");
    // The executor must resolve `evaluateOrDeny` through the module namespace for
    // the spy to be observable — re-imported here to pick up the spied binding.
    const { delegate: spiedDelegate } = await import("./delegation-executor.js");

    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const model = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "{}" }) });
    try {
      const supervisor = await createFixtureAgentVersion(ctx, "triage");
      const billing = await createFixtureAgentVersion(ctx, "billing_agent");
      const route = await createFixtureRoute(ctx, model.url);
      const created = await createTeamWithFirstVersion(
        ctx,
        { name: "support_team", artifact: teamArtifact("support_team", supervisor.pin, route.name, [memberSpec("billing", billing.pin)]) },
        AUTHOR,
      );
      const members = await listTeamMembers(ctx, created.version.id);
      const state = await buildRunState(ctx, created.version, members, supervisor.versionId, null);
      const runner: SpecialistRunner = { async run() { return { outcome: "answered", text: "ok", tokensIn: 0, tokensOut: 0, costUsd: "0" }; } };

      await spiedDelegate(ctx, { specialistRunner: runner }, state, rootHop(state), members[0]!, "refund", "billing");

      expect(spy).toHaveBeenCalledTimes(1);
      const [, input] = spy.mock.calls[0]!;
      const typed = input as { requested: { kind: string; toolId: string }; chain: ScopeDescriptor[]; depth: number; consumed: { delegations: number } };
      // The REAL chain: the team version's scope, then the member's own scope.
      expect(typed.chain.map((c) => c.origin)).toEqual(["TeamVersion", "TeamMember"]);
      expect(typed.requested.kind).toBe("AgentDelegation");
      expect(typed.requested.toolId).toBe(members[0]!.toolId);
      expect(typed.depth).toBe(1);
      expect(typed.consumed).toBeDefined();

      // A second hop calls it again — per-hop, not once per run.
      await spiedDelegate(ctx, { specialistRunner: runner }, state, rootHop(state), members[0]!, "a completely different question", "billing");
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      await model.close();
    }
  }, 60_000);
});

describe("ADVERSARIAL 3 — a delegation cannot grant a specialist a capability the caller itself lacks (real intersection narrowing)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("is rejected BEFORE the call executes — the specialist runner is never invoked", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const model = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "{}" }) });
    try {
      const supervisor = await createFixtureAgentVersion(ctx, "triage");
      const billing = await createFixtureAgentVersion(ctx, "billing_agent");
      const route = await createFixtureRoute(ctx, model.url);

      // Two passes over the same shape: first WITHOUT a restriction (to prove the
      // fixture is otherwise sound), then WITH the team version scoped to a
      // different tool set than the member needs.
      const permissive = await createTeamWithFirstVersion(
        ctx,
        { name: "permissive_team", artifact: teamArtifact("permissive_team", supervisor.pin, route.name, [memberSpec("billing", billing.pin)]) },
        AUTHOR,
      );
      const permissiveMembers = await listTeamMembers(ctx, permissive.version.id);
      let invoked = 0;
      const runner: SpecialistRunner = {
        async run() {
          invoked += 1;
          return { outcome: "answered", text: "ok", tokensIn: 0, tokensOut: 0, costUsd: "0" };
        },
      };
      const okState = await buildRunState(ctx, permissive.version, permissiveMembers, supervisor.versionId, null);
      expect((await delegate(ctx, { specialistRunner: runner }, okState, rootHop(okState), permissiveMembers[0]!, "task", "r")).outcome).toBe("Answered");
      expect(invoked).toBe(1);

      // Now the SUPERVISOR level (the team version's own scope) is narrowed to a
      // tool set that does NOT include the member's own agent-as-tool. The member
      // declares nothing, so under a union/precedence model it would still be
      // reachable — under intersection it is not.
      // A real, RFC-valid uuid that is simply not this member's tool.
      const otherToolId = crypto.randomUUID();
      const restricted = await createTeamWithFirstVersion(
        ctx,
        {
          name: "restricted_team",
          // BOTH id-shaped dimensions must be pinned: the evaluator's step 4b allows
          // a call when EITHER the tool id OR its capability group is reachable, and
          // an UNDECLARED `capabilityGroupIds` is the lattice top (`'*'`, reachable).
          // That is the evaluator's documented E3/4b semantics, not a workaround —
          // pinning only `toolIds` genuinely is not a restriction, and a test that
          // pretended otherwise would be asserting a guarantee the system does not make.
          artifact: teamArtifact("restricted_team", supervisor.pin, route.name, [memberSpec("billing", billing.pin)], {
            scope: { toolIds: [otherToolId], capabilityGroupIds: [] },
          }),
        },
        AUTHOR,
      );
      const restrictedMembers = await listTeamMembers(ctx, restricted.version.id);
      const state = await buildRunState(ctx, restricted.version, restrictedMembers, supervisor.versionId, null);
      invoked = 0;

      const result = await delegate(ctx, { specialistRunner: runner }, state, rootHop(state), restrictedMembers[0]!, "task", "r");

      expect(result.outcome).toBe("Denied");
      // Rejected BEFORE the call executes — this is the whole point.
      expect(invoked).toBe(0);
      const events = await listDelegationEventsForRun(ctx, state.agentRunId);
      expect(events).toHaveLength(1);
      expect(events[0]?.outcome).toBe("Denied");
      // …and for the RIGHT reason: the evaluator's own real scope-narrowing verdict,
      // persisted verbatim. Asserting the code (not merely "Denied") is what stops
      // this test passing on an unrelated malformed-input rejection.
      const denyRows = await withTenant(ctx, (db) =>
        db.select().from(schema.delegationEvent).where(and(eq(schema.delegationEvent.tenantId, ctx.tenantId), eq(schema.delegationEvent.agentRunId, state.agentRunId))),
      );
      expect((denyRows[0]?.outcomeDetail as { denyReason?: string }).denyReason).toBe("TOOL_NOT_IN_SCOPE");
    } finally {
      await model.close();
    }
  }, 60_000);

  it("a member declaring a WIDER tool set than its team version cannot widen it (composition narrows, never unions)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const model = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "{}" }) });
    try {
      const supervisor = await createFixtureAgentVersion(ctx, "triage");
      const billing = await createFixtureAgentVersion(ctx, "billing_agent");
      const route = await createFixtureRoute(ctx, model.url);
      const created = await createTeamWithFirstVersion(
        ctx,
        { name: "support_team", artifact: teamArtifact("support_team", supervisor.pin, route.name, [memberSpec("billing", billing.pin)]) },
        AUTHOR,
      );
      const members = await listTeamMembers(ctx, created.version.id);
      const memberToolId = members[0]!.toolId;
      const forbiddenToolId = crypto.randomUUID();

      // Re-author with the team version scoped to [memberTool] and the MEMBER
      // declaring [memberTool, forbiddenTool] — the member's extra entry must be
      // meaningless.
      const widened = await createTeamWithFirstVersion(
        ctx,
        {
          name: "widened_team",
          artifact: teamArtifact(
            "widened_team",
            supervisor.pin,
            route.name,
            [memberSpec("billing", billing.pin, { scope: { toolIds: [memberToolId, forbiddenToolId], capabilityGroupIds: [] } })],
            { scope: { toolIds: [memberToolId], capabilityGroupIds: [] } },
          ),
        },
        AUTHOR,
      );
      const widenedMembers = await listTeamMembers(ctx, widened.version.id);
      const state = await buildRunState(ctx, widened.version, widenedMembers, supervisor.versionId, null);
      const runner: SpecialistRunner = { async run() { return { outcome: "answered", text: "ok", tokensIn: 0, tokensOut: 0, costUsd: "0" }; } };

      // Delegating to the member's OWN tool is fine (it is in both sets)…
      const allowed = await delegate(ctx, { specialistRunner: runner }, state, rootHop(state), widenedMembers[0]!, "task", "r");
      expect(allowed.outcome).toBe("Answered");

      // …and the evaluator's own effective scope proves the extra entry was dropped.
      const authz = await import("@nextbot/authz");
      const evaluation = await authz.evaluateOrDeny(ctx, {
        tenantId: ctx.tenantId,
        tenantPolicy: await getTenantScopePolicy(ctx),
        chain: [widened.version.scopeJson as ScopeDescriptor, widenedMembers[0]!.scopeJson as ScopeDescriptor],
        depth: 1,
      });
      expect(evaluation.effectiveScope?.toolIds).toEqual([memberToolId]);
    } finally {
      await model.close();
    }
  }, 60_000);
});

describe("ADVERSARIAL 4 — PII re-masking at a hand-off is keyed to the RECEIVING member's trust level (FR-ORC-05)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a high-trust supervisor's context is re-masked DOWN when handed to a low-trust specialist", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const model = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "{}" }) });
    try {
      // A REAL tenant masking-context matrix: an email is shown to a Trusted
      // receiver and fully masked for an Untrusted one, in the hand-off context.
      await setPiiPolicy(ctx, "Email", "ToolCallPayload", "Trusted", "Show");
      await setPiiPolicy(ctx, "Email", "ToolCallPayload", "Untrusted", "FullMask");

      const supervisor = await createFixtureAgentVersion(ctx, "triage", { trustLevel: "Trusted" });
      const trusted = await createFixtureAgentVersion(ctx, "trusted_agent", { trustLevel: "Trusted" });
      const untrusted = await createFixtureAgentVersion(ctx, "untrusted_agent", { trustLevel: "Untrusted" });
      const route = await createFixtureRoute(ctx, model.url);
      const created = await createTeamWithFirstVersion(
        ctx,
        {
          name: "support_team",
          artifact: teamArtifact("support_team", supervisor.pin, route.name, [
            memberSpec("trusted", trusted.pin),
            memberSpec("untrusted", untrusted.pin),
          ]),
        },
        AUTHOR,
      );
      const members = await listTeamMembers(ctx, created.version.id);
      const state = await buildRunState(ctx, created.version, members, supervisor.versionId, null);

      const seen: Record<string, string> = {};
      const byVersionId = new Map(members.map((m) => [m.definitionVersionId, m.memberKey]));
      const runner: SpecialistRunner = {
        async run(input) {
          seen[byVersionId.get(input.definitionVersionId)!] = input.task;
          return { outcome: "answered", text: "ok", tokensIn: 0, tokensOut: 0, costUsd: "0" };
        },
      };

      // The SAME transcript slice, handed to two members with different trust levels.
      const TRANSCRIPT = "Please email the receipt to jane.doe@example.com right away.";
      await delegate(ctx, { specialistRunner: runner }, state, rootHop(state), members.find((m) => m.memberKey === "trusted")!, TRANSCRIPT, "r");
      await delegate(ctx, { specialistRunner: runner }, state, rootHop(state), members.find((m) => m.memberKey === "untrusted")!, TRANSCRIPT, "r");

      // Keyed to the RECEIVER, not the sender: the supervisor is Trusted in both cases.
      expect(seen.trusted).toContain("jane.doe@example.com");
      expect(seen.untrusted).not.toContain("jane.doe@example.com");
      expect(seen.untrusted).toContain("*");

      // And the value RETAINED for the thrash guard is the masked one, so the guard
      // can never become a place unmasked PII is stored.
      const rows = await withTenant(ctx, (db) =>
        db.select().from(schema.delegationEvent).where(and(eq(schema.delegationEvent.tenantId, ctx.tenantId), eq(schema.delegationEvent.agentRunId, state.agentRunId))),
      );
      const untrustedRow = rows.find((r) => r.toMemberId === members.find((m) => m.memberKey === "untrusted")!.id)!;
      expect(JSON.stringify(untrustedRow.outcomeDetail)).not.toContain("jane.doe@example.com");
    } finally {
      await model.close();
    }
  }, 60_000);

  it("fails CLOSED: a specialist that declares no trustLevel is treated as Untrusted, not as trusted", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const model = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "{}" }) });
    try {
      await setPiiPolicy(ctx, "Email", "ToolCallPayload", "Trusted", "Show");
      await setPiiPolicy(ctx, "Email", "ToolCallPayload", "Untrusted", "FullMask");

      const supervisor = await createFixtureAgentVersion(ctx, "triage", { trustLevel: "Trusted" });
      // NO trustLevel declared at all.
      const undeclared = await createFixtureAgentVersion(ctx, "undeclared_agent");
      const route = await createFixtureRoute(ctx, model.url);
      const created = await createTeamWithFirstVersion(
        ctx,
        { name: "support_team", artifact: teamArtifact("support_team", supervisor.pin, route.name, [memberSpec("undeclared", undeclared.pin)]) },
        AUTHOR,
      );
      const members = await listTeamMembers(ctx, created.version.id);
      const state = await buildRunState(ctx, created.version, members, supervisor.versionId, null);

      let seenTask = "";
      const runner: SpecialistRunner = {
        async run(input) {
          seenTask = input.task;
          return { outcome: "answered", text: "ok", tokensIn: 0, tokensOut: 0, costUsd: "0" };
        },
      };
      await delegate(ctx, { specialistRunner: runner }, state, rootHop(state), members[0]!, "email jane.doe@example.com the receipt", "r");
      expect(seenTask).not.toContain("jane.doe@example.com");
    } finally {
      await model.close();
    }
  }, 60_000);
});
