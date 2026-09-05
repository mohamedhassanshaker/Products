import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, type TenantContext } from "@nextbot/db";
import { startAgentRun } from "@nextbot/agent-platform";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import type { TeamMemberSpec } from "@nextbot/contracts";
import { createFixtureAgentVersion, createFixtureRoute, teamArtifact } from "../testing/team-fixtures.js";
import { createTeamWithFirstVersion } from "./team-service.js";
import { listTeamMembers, type TeamMemberRow, type TeamVersionRow } from "../infrastructure/team-repository.js";
import { insertDelegationEvent } from "../infrastructure/delegation-event-repository.js";
import { getDelegationTree } from "./delegation-tree-service.js";

/**
 * The delegation trace tree's READ side (Phase 6/BL-37), now exercised against REAL
 * `team_version`/`team_member` rows.
 *
 * Phase 6 had to insert `delegation_event` rows with synthetic `team_version_id`/
 * `to_member_id` values, because those tables did not exist. Phase 14 (BL-46) both
 * creates them and adds the real FK constraints, so this suite now builds a genuine
 * team first — which also means `memberKey` (`null` throughout Phase 6, by disclosed
 * necessity) is asserted for real here.
 */
const AUTHOR = "11111111-1111-1111-1111-111111111111";
let mockModel: MockOpenAiServerHandle;

function memberSpec(key: string, pin: string): TeamMemberSpec {
  return { key, agent: pin, delegationTier: "Tier1", invokeWhen: `about ${key}`, fallbackAction: "Escalate" };
}

interface Fixture {
  ctx: TenantContext;
  supervisorVersionId: string;
  version: TeamVersionRow;
  members: TeamMemberRow[];
}

async function fixture(createdTenantIds: string[]): Promise<Fixture> {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  const supervisor = await createFixtureAgentVersion(ctx, "supervisor");
  const billing = await createFixtureAgentVersion(ctx, "billing_agent");
  const route = await createFixtureRoute(ctx, mockModel.url);
  const created = await createTeamWithFirstVersion(
    ctx,
    { name: "support_team", artifact: teamArtifact("support_team", supervisor.pin, route.name, [memberSpec("billing", billing.pin)]) },
    AUTHOR,
  );
  return { ctx, supervisorVersionId: supervisor.versionId, version: created.version, members: await listTeamMembers(ctx, created.version.id) };
}

async function addEvent(
  f: Fixture,
  agentRunId: string,
  overrides: { id?: string; depth: number; siblingOrdinal?: number; parentDelegationEventId?: string | null; toMemberId?: string; toAgentVersionId?: string; reason?: string },
): Promise<string> {
  const member = f.members[0]!;
  const row = await insertDelegationEvent(f.ctx, {
    conversationId: null,
    agentRunId,
    teamVersionId: f.version.id,
    parentDelegationEventId: overrides.parentDelegationEventId ?? null,
    parentSpanId: null,
    spanId: generateId(),
    depth: overrides.depth,
    siblingOrdinal: overrides.siblingOrdinal ?? 0,
    fromAgentVersionId: f.supervisorVersionId,
    fromMemberId: null,
    toAgentVersionId: overrides.toAgentVersionId ?? member.definitionVersionId,
    toMemberId: overrides.toMemberId ?? member.id,
    toolCallId: null,
    reason: overrides.reason ?? "routing rationale",
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
  return row.id;
}

describe("getDelegationTree (LLD §14.7.2/§14.7.5, real Postgres + real team rows)", () => {
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

  it("returns an empty forest for a run with no delegation_event rows (every single-agent run)", async () => {
    const f = await fixture(createdTenantIds);
    const { run } = await startAgentRun(f.ctx, { agentDefinitionVersionId: f.supervisorVersionId, trigger: "SandboxTest" });
    expect(await getDelegationTree(f.ctx, run.id)).toEqual({ agentRunId: run.id, roots: [] });
  });

  it("assembles a real two-level tree with a resolved agentLabel AND a resolved memberKey (Phase 14 populates what Phase 6 had to leave null)", async () => {
    const f = await fixture(createdTenantIds);
    const { run } = await startAgentRun(f.ctx, { agentDefinitionVersionId: f.supervisorVersionId, trigger: "CustomerMessage" });

    const rootId = await addEvent(f, run.id, { depth: 1, reason: "billing question, routing to specialist" });
    const childId = await addEvent(f, run.id, { depth: 2, parentDelegationEventId: rootId, reason: "sub-delegated" });

    const tree = await getDelegationTree(f.ctx, run.id);
    expect(tree.agentRunId).toBe(run.id);
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0]?.delegationEventId).toBe(rootId);
    expect(tree.roots[0]?.agentLabel).toBe("billing_agent@1.0.0");
    expect(tree.roots[0]?.memberKey).toBe("billing");
    expect(tree.roots[0]?.children).toHaveLength(1);
    expect(tree.roots[0]?.children[0]?.delegationEventId).toBe(childId);
    expect(tree.roots[0]?.children[0]?.memberKey).toBe("billing");
  });

  it("only returns rows for the requested agentRunId, scoped correctly across two runs", async () => {
    const f = await fixture(createdTenantIds);
    const { run: runA } = await startAgentRun(f.ctx, { agentDefinitionVersionId: f.supervisorVersionId, trigger: "SandboxTest" });
    const { run: runB } = await startAgentRun(f.ctx, { agentDefinitionVersionId: f.supervisorVersionId, trigger: "SandboxTest" });

    await addEvent(f, runA.id, { depth: 1 });
    await addEvent(f, runB.id, { depth: 1 });

    const treeA = await getDelegationTree(f.ctx, runA.id);
    const treeB = await getDelegationTree(f.ctx, runB.id);
    expect(treeA.roots).toHaveLength(1);
    expect(treeB.roots).toHaveLength(1);
    expect(treeA.roots[0]?.delegationEventId).not.toBe(treeB.roots[0]?.delegationEventId);
  });
});
