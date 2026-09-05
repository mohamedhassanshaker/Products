import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, withTenant } from "@nextbot/db";
import type { TeamMemberSpec } from "@nextbot/contracts";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createFixtureAgentVersion, createFixtureConversation, createFixtureRoute, teamArtifact } from "../testing/team-fixtures.js";
import { createTeamWithFirstVersion } from "./team-service.js";
import { runTeamSandbox, runTeamTurn } from "./team-run-service.js";
import { getSandboxCoverage, transitionTeamVersion } from "./team-version-service.js";
import { findTeamVersionById, listTeamMembers } from "../infrastructure/team-repository.js";
import { getDelegationTree } from "./delegation-tree-service.js";
import type { SpecialistRunner } from "../ports/specialist-runner.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-03/10/11) — the supervisor
 * loop and the whole-topology sandbox run, end to end against real Postgres with a
 * real (mock-backed) router model call through the version's PINNED supervisor route.
 */
const AUTHOR = "11111111-1111-1111-1111-111111111111";
const REVIEWER = "22222222-2222-2222-2222-222222222222";

/** The router's scripted decision. A test may push a QUEUE of decisions when a run
 * makes more than one routing call (FR-ORC-10's single re-route). */
let routingDecision: { memberKey: string; reason: string; confidence: number } = { memberKey: "billing", reason: "billing question", confidence: 0.9 };
let routingQueue: Array<{ memberKey: string; reason: string; confidence: number }> = [];
let modelServer: MockOpenAiServerHandle;

function memberSpec(key: string, pin: string, overrides: Partial<TeamMemberSpec> = {}): TeamMemberSpec {
  return { key, agent: pin, delegationTier: "Tier1", invokeWhen: `about ${key}`, fallbackAction: "Escalate", ...overrides };
}

const answeringRunner: SpecialistRunner = {
  async run(input) {
    return { outcome: "answered", text: `handled: ${input.task}`, tokensIn: 1, tokensOut: 1, costUsd: "0.001" };
  },
};

describe("runTeamTurn — the supervisor loop (FR-ORC-03/10)", () => {
  const createdTenantIds: string[] = [];
  beforeAll(async () => {
    modelServer = await startMockOpenAiCompatibleServer({
      onChatCompletion: () => ({ content: JSON.stringify(routingQueue.shift() ?? routingDecision) }),
    });
  });
  afterAll(async () => {
    await modelServer.close();
  });
  afterEach(async () => {
    routingDecision = { memberKey: "billing", reason: "billing question", confidence: 0.9 };
    routingQueue = [];
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  async function fixture() {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const supervisor = await createFixtureAgentVersion(ctx, "triage");
    const billing = await createFixtureAgentVersion(ctx, "billing_agent");
    const shipping = await createFixtureAgentVersion(ctx, "shipping_agent");
    const route = await createFixtureRoute(ctx, modelServer.url);
    const created = await createTeamWithFirstVersion(
      ctx,
      {
        name: "support_team",
        artifact: teamArtifact("support_team", supervisor.pin, route.name, [memberSpec("billing", billing.pin), memberSpec("shipping", shipping.pin)]),
      },
      AUTHOR,
    );
    return { ctx, supervisor, version: created.version, team: created.team, members: await listTeamMembers(ctx, created.version.id) };
  }

  it("routes to the member the PINNED router route selects, and returns that specialist's answer", async () => {
    const f = await fixture();
    routingDecision = { memberKey: "shipping", reason: "parcel tracking", confidence: 0.92 };

    const result = await runTeamTurn(f.ctx, { specialistRunner: answeringRunner }, {
      teamVersionId: f.version.id,
      task: "where is my parcel",
      conversationId: null,
    });

    expect(result.outcome).toBe("Answered");
    expect(result.answerText).toBe("handled: where is my parcel");
    // The chain starts at the SUPERVISOR (depth 0, no member row) — FR-ORC-04's
    // "delegated by <supervisor>" context.
    expect(result.chain[0]).toMatchObject({ depth: 0, memberKey: null, agentLabel: "triage@1.0.0" });
    expect(result.chain[1]).toMatchObject({ depth: 1, memberKey: "shipping", reason: "parcel tracking" });

    const tree = await getDelegationTree(f.ctx, result.agentRunId);
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0]?.memberKey).toBe("shipping");

    // The router call really went through the PINNED supervisor route version, so a
    // usage event is attributed to it (never to a free-text model string).
    const usage = await withTenant(f.ctx, (db) =>
      db.select().from(schema.modelUsageEvent).where(and(eq(schema.modelUsageEvent.tenantId, f.ctx.tenantId), eq(schema.modelUsageEvent.routeKey, "team.supervisor.route"))),
    );
    expect(usage.length).toBeGreaterThanOrEqual(1);
    expect(usage[0]?.routeVersionId).toBe(f.version.supervisorRouteVersionId);
  });

  it("FR-ORC-10: a `not_mine` answer re-routes ONCE to a different member, and never back to the same one", async () => {
    const f = await fixture();
    const seen: string[] = [];
    const byVersionId = new Map(f.members.map((m) => [m.definitionVersionId, m.memberKey]));
    let call = 0;
    const runner: SpecialistRunner = {
      async run(input) {
        seen.push(byVersionId.get(input.definitionVersionId)!);
        call += 1;
        return call === 1
          ? { outcome: "not_mine", text: "not my area", tokensIn: 0, tokensOut: 0, costUsd: "0" }
          : { outcome: "answered", text: "handled", tokensIn: 0, tokensOut: 0, costUsd: "0" };
      },
    };
    // First decision: `billing` (wrong). Second decision (the single permitted
    // re-route): `shipping`. The already-tried member is removed from the candidate
    // set regardless, so the router cannot re-pick it even if it tried.
    routingQueue = [
      { memberKey: "billing", reason: "guessed billing", confidence: 0.7 },
      { memberKey: "shipping", reason: "re-routed after not_mine", confidence: 0.85 },
    ];

    const result = await runTeamTurn(f.ctx, { specialistRunner: runner }, { teamVersionId: f.version.id, task: "where is my parcel", conversationId: null });

    expect(seen[0]).toBe("billing");
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe("billing");
    expect(result.outcome).toBe("Answered");
    // BOTH hops are traced — `NotMine` is a first-class outcome, not a swallowed retry.
    const tree = await getDelegationTree(f.ctx, result.agentRunId);
    expect(tree.roots).toHaveLength(2);
    expect(tree.roots.map((r) => r.outcome).sort()).toEqual(["Answered", "NotMine"]);
  });

  it("FR-ORC-10: the supervisor ESCALATES rather than answering itself when no member matches", async () => {
    const f = await fixture();
    const conversationId = await createFixtureConversation(f.ctx);
    routingDecision = { memberKey: "none", reason: "nothing matches this request", confidence: 0.4 };
    let escalated = 0;

    const result = await runTeamTurn(
      f.ctx,
      {
        specialistRunner: answeringRunner,
        escalationSink: {
          async escalate() {
            escalated += 1;
            return { escalationId: "11111111-1111-1111-1111-1111111111ee", created: true };
          },
        },
      },
      { teamVersionId: f.version.id, task: "something unrelated", conversationId },
    );

    expect(result.outcome).toBe("Escalated");
    // The defining guarantee: NO answer was substituted by the supervisor.
    expect(result.answerText).toBeNull();
    expect(escalated).toBe(1);
  });
});

describe("runTeamSandbox — FR-ORC-11's whole-topology gate", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("exercises EVERY member, records `sandbox_run_id`, and unlocks the Approved gate that a partial run does not", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const supervisor = await createFixtureAgentVersion(ctx, "triage");
    const billing = await createFixtureAgentVersion(ctx, "billing_agent");
    const shipping = await createFixtureAgentVersion(ctx, "shipping_agent");
    const route = await createFixtureRoute(ctx, modelServer.url);
    const created = await createTeamWithFirstVersion(
      ctx,
      {
        name: "support_team",
        artifact: teamArtifact("support_team", supervisor.pin, route.name, [memberSpec("billing", billing.pin), memberSpec("shipping", shipping.pin)]),
      },
      AUTHOR,
    );

    // Before any sandbox run, the gate refuses.
    await transitionTeamVersion(ctx, created.version.id, "EvalGated", REVIEWER);
    await transitionTeamVersion(ctx, created.version.id, "HumanReview", REVIEWER);
    await expect(transitionTeamVersion(ctx, created.version.id, "Approved", REVIEWER)).rejects.toThrow(/no sandbox run recorded/);

    const result = await runTeamSandbox(ctx, { specialistRunner: answeringRunner }, {
      teamVersionId: created.version.id,
      task: "exercise the whole team",
      conversationId: null,
    });

    // Every member was really delegated to — a supervisor-only run would not be.
    const tree = await getDelegationTree(ctx, result.agentRunId);
    expect(tree.roots.map((r) => r.memberKey).sort()).toEqual(["billing", "shipping"]);

    const refreshed = (await findTeamVersionById(ctx, created.version.id))!;
    expect(refreshed.sandboxRunId).toBe(result.agentRunId);
    const coverage = await getSandboxCoverage(ctx, refreshed);
    expect(coverage?.missingMemberKeys).toEqual([]);

    // …and the same gate now passes.
    expect((await transitionTeamVersion(ctx, created.version.id, "Approved", REVIEWER)).status).toBe("Approved");
  });

  it("does NOT consult the router at all — it delegates to every member by construction, so a router that always picks one member cannot produce a passing partial run", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const supervisor = await createFixtureAgentVersion(ctx, "triage");
    const billing = await createFixtureAgentVersion(ctx, "billing_agent");
    const shipping = await createFixtureAgentVersion(ctx, "shipping_agent");
    const route = await createFixtureRoute(ctx, modelServer.url);
    const created = await createTeamWithFirstVersion(
      ctx,
      {
        name: "support_team",
        artifact: teamArtifact("support_team", supervisor.pin, route.name, [memberSpec("billing", billing.pin), memberSpec("shipping", shipping.pin)]),
      },
      AUTHOR,
    );
    // A router that would ALWAYS choose `billing` — irrelevant to the sandbox run.
    routingDecision = { memberKey: "billing", reason: "always billing", confidence: 0.99 };

    const result = await runTeamSandbox(ctx, { specialistRunner: answeringRunner }, {
      teamVersionId: created.version.id,
      task: "exercise the whole team",
      conversationId: null,
    });
    const tree = await getDelegationTree(ctx, result.agentRunId);
    expect(tree.roots).toHaveLength(2);
  });
});
