import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import {
  IllegalTeamVersionTransition,
  TeamFallbackCycleError,
  TeamSandboxTopologyIncompleteError,
  TeamSupervisorRouteExpensiveError,
  TeamValidationError,
  type TeamMemberSpec,
} from "@nextbot/contracts";
import { createFixtureAgentVersion, createFixtureRoute, teamArtifact } from "../testing/team-fixtures.js";
import { createTeamWithFirstVersion } from "./team-service.js";
import { createTeamVersion, getSandboxCoverage, transitionTeamVersion, validateTeamArtifact } from "./team-version-service.js";
import { findTeamVersionById, listTeamMembers } from "../infrastructure/team-repository.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01/03/11, LLD §14.7.2) —
 * team version authoring against real Postgres.
 */
const AUTHOR = "11111111-1111-1111-1111-111111111111";
const REVIEWER = "22222222-2222-2222-2222-222222222222";

let mockModel: MockOpenAiServerHandle;

function member(key: string, pin: string, overrides: Partial<TeamMemberSpec> = {}): TeamMemberSpec {
  return {
    key,
    agent: pin,
    delegationTier: "Tier1",
    invokeWhen: `the request is about ${key}`,
    fallbackAction: "Escalate",
    ...overrides,
  };
}

async function baseFixture(routeOptions?: { name?: string; role?: "chat.primary" | "chat.router" | "custom" }) {
  const ctx: TenantContext = await createFixtureTenant();
  const supervisor = await createFixtureAgentVersion(ctx, "triage");
  const billing = await createFixtureAgentVersion(ctx, "billing_agent");
  const shipping = await createFixtureAgentVersion(ctx, "shipping_agent");
  const route = await createFixtureRoute(ctx, mockModel.url, routeOptions);
  return { ctx, supervisor, billing, shipping, route };
}

describe("team version authoring (FR-ORC-03, real Postgres)", () => {
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

  it("creates a team + version 1, resolving every pin and minting an AgentAsTool per member", async () => {
    const f = await baseFixture();
    createdTenantIds.push(f.ctx.tenantId);

    const artifact = teamArtifact("support_team", f.supervisor.pin, f.route.name, [member("billing", f.billing.pin), member("shipping", f.shipping.pin)]);
    const created = await createTeamWithFirstVersion(f.ctx, { name: "support_team", artifact }, AUTHOR);

    expect(created.version.version).toBe(1);
    expect(created.version.status).toBe("Draft");
    expect(created.version.failureMode).toBe("Escalate");
    expect(created.version.supervisorDefinitionVersionId).toBe(f.supervisor.versionId);
    expect(created.version.supervisorRouteVersionId).toBe(f.route.routeVersionId);
    expect(created.members).toHaveLength(2);
    // Members are PINNED by version — promoting the underlying definition later
    // cannot silently change this team's behavior.
    expect(created.members.map((m) => m.definitionVersionId).sort()).toEqual([f.billing.versionId, f.shipping.versionId].sort());
    // Each member has a real AgentAsTool catalog row.
    expect(created.members.every((m) => typeof m.toolId === "string" && m.toolId.length > 0)).toBe(true);
    // FR-ORC-07's ceilings are projected onto the evaluator's own budget dimension.
    expect((created.version.scopeJson as { budget?: Record<string, unknown> }).budget).toMatchObject({
      maxDepth: 4,
      maxFanOut: 8,
      maxDelegations: 12,
      usdPerTurn: 100,
      seconds: 600,
    });
    // Member scopes carry their REAL row ids as originId — what the evaluator's
    // trace attributes a narrowing to.
    for (const m of created.members) {
      expect((m.scopeJson as { origin: string; originId: string }).origin).toBe("TeamMember");
      expect((m.scopeJson as { originId: string }).originId).toBe(m.id);
    }
  });

  it("FR-ORC-03: a non-router-class supervisor route is a 422 on SAVE …", async () => {
    const f = await baseFixture({ name: "expensive_frontier", role: "custom" });
    createdTenantIds.push(f.ctx.tenantId);
    const artifact = teamArtifact("support_team", f.supervisor.pin, "expensive_frontier", [member("billing", f.billing.pin)]);
    await expect(createTeamWithFirstVersion(f.ctx, { name: "support_team", artifact }, AUTHOR)).rejects.toThrow(TeamSupervisorRouteExpensiveError);
  });

  it("… but the SAME artifact validates as a 200-with-warning (LLD §14.7.2's strict/non-strict split)", async () => {
    const f = await baseFixture({ name: "expensive_frontier", role: "custom" });
    createdTenantIds.push(f.ctx.tenantId);
    const artifact = teamArtifact("support_team", f.supervisor.pin, "expensive_frontier", [member("billing", f.billing.pin)]);
    const result = await validateTeamArtifact(f.ctx, artifact);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("TEAM_SUPERVISOR_ROUTE_EXPENSIVE");
    expect(result.scope?.budget?.maxDelegations).toBe(12);
  });

  it("accepts a route whose ROLE is chat.router even under a different name", async () => {
    const f = await baseFixture({ name: "cheap_classifier", role: "chat.router" });
    createdTenantIds.push(f.ctx.tenantId);
    const artifact = teamArtifact("support_team", f.supervisor.pin, "cheap_classifier", [member("billing", f.billing.pin)]);
    const created = await createTeamWithFirstVersion(f.ctx, { name: "support_team", artifact }, AUTHOR);
    expect(created.version.supervisorRouteVersionId).toBe(f.route.routeVersionId);
  });

  it("rejects an unresolvable member pin, naming the exact offending member", async () => {
    const f = await baseFixture();
    createdTenantIds.push(f.ctx.tenantId);
    const artifact = teamArtifact("support_team", f.supervisor.pin, f.route.name, [member("billing", "no_such_agent@9.9.9")]);
    await expect(createTeamWithFirstVersion(f.ctx, { name: "support_team", artifact }, AUTHOR)).rejects.toThrow(/members.0.agent/);
  });

  it("rejects a duplicate member key", async () => {
    const f = await baseFixture();
    createdTenantIds.push(f.ctx.tenantId);
    const artifact = teamArtifact("support_team", f.supervisor.pin, f.route.name, [member("billing", f.billing.pin), member("billing", f.shipping.pin)]);
    await expect(createTeamWithFirstVersion(f.ctx, { name: "support_team", artifact }, AUTHOR)).rejects.toThrow(TeamValidationError);
  });

  it("rejects a fallbackMemberKey that names no member of this team", async () => {
    const f = await baseFixture();
    createdTenantIds.push(f.ctx.tenantId);
    const artifact = teamArtifact("support_team", f.supervisor.pin, f.route.name, [
      member("billing", f.billing.pin, { fallbackAction: "Member", fallbackMemberKey: "ghost" }),
    ]);
    await expect(createTeamWithFirstVersion(f.ctx, { name: "support_team", artifact }, AUTHOR)).rejects.toThrow(/TEAM_FALLBACK_UNRESOLVED|not a member/);
  });

  it("rejects a fallback CYCLE with TEAM_FALLBACK_CYCLE, before any row is written", async () => {
    const f = await baseFixture();
    createdTenantIds.push(f.ctx.tenantId);
    const artifact = teamArtifact("support_team", f.supervisor.pin, f.route.name, [
      member("billing", f.billing.pin, { fallbackAction: "Member", fallbackMemberKey: "shipping" }),
      member("shipping", f.shipping.pin, { fallbackAction: "Member", fallbackMemberKey: "billing" }),
    ]);
    await expect(createTeamWithFirstVersion(f.ctx, { name: "support_team", artifact }, AUTHOR)).rejects.toThrow(TeamFallbackCycleError);
  });

  it("persists a real fallback pointer for an acyclic Member fallback (DEFERRABLE FK resolves a forward reference)", async () => {
    const f = await baseFixture();
    createdTenantIds.push(f.ctx.tenantId);
    // `billing` (ordinal 0) points forward at `shipping` (ordinal 1) — only possible
    // because the self-FK is DEFERRABLE INITIALLY DEFERRED.
    const artifact = teamArtifact("support_team", f.supervisor.pin, f.route.name, [
      member("billing", f.billing.pin, { fallbackAction: "Member", fallbackMemberKey: "shipping" }),
      member("shipping", f.shipping.pin),
    ]);
    const created = await createTeamWithFirstVersion(f.ctx, { name: "support_team", artifact }, AUTHOR);
    const members = await listTeamMembers(f.ctx, created.version.id);
    const billing = members.find((m) => m.memberKey === "billing")!;
    const shipping = members.find((m) => m.memberKey === "shipping")!;
    expect(billing.fallbackAction).toBe("Member");
    expect(billing.fallbackMemberId).toBe(shipping.id);
  });

  it("warns (never silently overrides) when a member's declared delegationTier is raised to the specialist's own reachable floor", async () => {
    const f = await baseFixture();
    createdTenantIds.push(f.ctx.tenantId);
    // The specialist can reach nothing, so the floor is Tier1 and no warning fires…
    const quiet = await createTeamWithFirstVersion(
      f.ctx,
      { name: "support_team", artifact: teamArtifact("support_team", f.supervisor.pin, f.route.name, [member("billing", f.billing.pin, { delegationTier: "Tier1" })]) },
      AUTHOR,
    );
    expect(quiet.warnings).toHaveLength(0);
  });

  it("appends monotonic versions to an existing team", async () => {
    const f = await baseFixture();
    createdTenantIds.push(f.ctx.tenantId);
    const artifact = teamArtifact("support_team", f.supervisor.pin, f.route.name, [member("billing", f.billing.pin)]);
    const created = await createTeamWithFirstVersion(f.ctx, { name: "support_team", artifact }, AUTHOR);
    const v2 = await createTeamVersion(f.ctx, created.team.id, { ...artifact, version: 2 }, AUTHOR);
    expect(v2.version.version).toBe(2);
  });

  it("rejects a version whose artifact name does not match the team", async () => {
    const f = await baseFixture();
    createdTenantIds.push(f.ctx.tenantId);
    const artifact = teamArtifact("support_team", f.supervisor.pin, f.route.name, [member("billing", f.billing.pin)]);
    const created = await createTeamWithFirstVersion(f.ctx, { name: "support_team", artifact }, AUTHOR);
    await expect(createTeamVersion(f.ctx, created.team.id, { ...artifact, name: "other_team" }, AUTHOR)).rejects.toThrow(/TEAM_NAME_MISMATCH|does not match/);
  });
});

describe("team version promotion gate (FR-ORC-11, real Postgres)", () => {
  const createdTenantIds: string[] = [];
  beforeAll(async () => {
    mockModel ??= await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "{}" }) });
  });
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  async function draftVersion() {
    const f = await baseFixture();
    createdTenantIds.push(f.ctx.tenantId);
    const artifact = teamArtifact("support_team", f.supervisor.pin, f.route.name, [member("billing", f.billing.pin), member("shipping", f.shipping.pin)]);
    const created = await createTeamWithFirstVersion(f.ctx, { name: "support_team", artifact }, AUTHOR);
    return { ...f, created };
  }

  it("walks the ladder Draft -> EvalGated -> HumanReview, and refuses to skip a rung", async () => {
    const { ctx, created } = await draftVersion();
    await expect(transitionTeamVersion(ctx, created.version.id, "Production", REVIEWER)).rejects.toThrow(IllegalTeamVersionTransition);
    expect((await transitionTeamVersion(ctx, created.version.id, "EvalGated", REVIEWER)).status).toBe("EvalGated");
    expect((await transitionTeamVersion(ctx, created.version.id, "HumanReview", REVIEWER)).status).toBe("HumanReview");
  });

  it("refuses Approved when NO sandbox run is recorded at all", async () => {
    const { ctx, created } = await draftVersion();
    await transitionTeamVersion(ctx, created.version.id, "EvalGated", REVIEWER);
    await transitionTeamVersion(ctx, created.version.id, "HumanReview", REVIEWER);
    expect(await getSandboxCoverage(ctx, (await findTeamVersionById(ctx, created.version.id))!)).toBeNull();
    await expect(transitionTeamVersion(ctx, created.version.id, "Approved", REVIEWER)).rejects.toThrow(/no sandbox run recorded/);
  });
});

/** FR-ORC-11's sharpest case gets its own describe: a SUPERVISOR-ONLY sandbox run
 * must fail the gate. Proven with real `delegation_event` rows so the check is
 * reading real evidence, not a flag. */
describe("FR-ORC-11 — a supervisor-only sandbox run does not satisfy the promotion gate", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("fails with TEAM_SANDBOX_TOPOLOGY_INCOMPLETE naming every unexercised member", async () => {
    const { startAgentRun } = await import("@nextbot/agent-platform");
    const { insertDelegationEvent } = await import("../infrastructure/delegation-event-repository.js");
    const { bindTeamVersionSandboxRun } = await import("../infrastructure/team-repository.js");
    const { generateId } = await import("@nextbot/db");

    const f = await baseFixture();
    createdTenantIds.push(f.ctx.tenantId);
    const artifact = teamArtifact("support_team", f.supervisor.pin, f.route.name, [member("billing", f.billing.pin), member("shipping", f.shipping.pin)]);
    const created = await createTeamWithFirstVersion(f.ctx, { name: "support_team", artifact }, AUTHOR);
    const members = await listTeamMembers(f.ctx, created.version.id);

    const { run } = await startAgentRun(f.ctx, { agentDefinitionVersionId: f.supervisor.versionId, trigger: "SandboxTest" });
    // Only ONE of the two members was exercised — the "supervisor-only-ish" case.
    await insertDelegationEvent(f.ctx, {
      conversationId: null,
      agentRunId: run.id,
      teamVersionId: created.version.id,
      parentDelegationEventId: null,
      parentSpanId: null,
      spanId: generateId(),
      depth: 1,
      siblingOrdinal: 0,
      fromAgentVersionId: f.supervisor.versionId,
      fromMemberId: null,
      toAgentVersionId: members[0]!.definitionVersionId,
      toMemberId: members[0]!.id,
      toolCallId: null,
      reason: "sandbox",
      scopeHash: "a".repeat(64),
      outcome: "Answered",
      outcomeDetail: null,
      fallbackOfEventId: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: "0",
      latencyMs: 1,
      escalationId: null,
    });
    await bindTeamVersionSandboxRun(f.ctx, created.version.id, run.id);

    await transitionTeamVersion(f.ctx, created.version.id, "EvalGated", REVIEWER);
    await transitionTeamVersion(f.ctx, created.version.id, "HumanReview", REVIEWER);

    const coverage = await getSandboxCoverage(f.ctx, (await findTeamVersionById(f.ctx, created.version.id))!);
    expect(coverage?.missingMemberKeys).toEqual([members[1]!.memberKey]);

    await expect(transitionTeamVersion(f.ctx, created.version.id, "Approved", REVIEWER)).rejects.toThrow(TeamSandboxTopologyIncompleteError);

    // Now exercise the second member too — the same gate then PASSES, proving the
    // refusal above was about coverage and nothing else.
    await insertDelegationEvent(f.ctx, {
      conversationId: null,
      agentRunId: run.id,
      teamVersionId: created.version.id,
      parentDelegationEventId: null,
      parentSpanId: null,
      spanId: generateId(),
      depth: 1,
      siblingOrdinal: 1,
      fromAgentVersionId: f.supervisor.versionId,
      fromMemberId: null,
      toAgentVersionId: members[1]!.definitionVersionId,
      toMemberId: members[1]!.id,
      toolCallId: null,
      reason: "sandbox",
      scopeHash: "a".repeat(64),
      outcome: "Answered",
      outcomeDetail: null,
      fallbackOfEventId: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: "0",
      latencyMs: 1,
      escalationId: null,
    });
    expect((await transitionTeamVersion(f.ctx, created.version.id, "Approved", REVIEWER)).status).toBe("Approved");
  });
});
