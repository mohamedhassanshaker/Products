import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { schema, withTenant, type TenantContext } from "@nextbot/db";
import { and, eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { startAgentRun } from "@nextbot/agent-platform";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createFixtureAgentVersion, createFixtureRoute, teamArtifact } from "../testing/team-fixtures.js";
import { createTeamWithFirstVersion } from "./team-service.js";
import { getDelegationTree } from "./delegation-tree-service.js";
import { insertDelegationEvent } from "../infrastructure/delegation-event-repository.js";
import { findTeamById, findTeamVersionById, listTeamMembers, listTeams } from "../infrastructure/team-repository.js";

/**
 * ADR-0001 §6 cross-tenant proof for the whole of Module E (LLD §3.2 rule 1).
 *
 * Phase 6 (BL-37) proved it for `delegation_event` alone, before any live writer
 * existed. Phase 14 (BL-46) makes that table's contents REAL — routing rationale,
 * cost, the specialist's own scope hash — and adds three more tenant-scoped tables
 * (`team`, `team_version`, `team_member`), so the boundary is re-proven here for all
 * four, against real rows produced by the real writers.
 */
const AUTHOR = "11111111-1111-1111-1111-111111111111";
let mockModel: MockOpenAiServerHandle;

describe("Module E tenant isolation (ADR-0001 §6 / LLD §3.2)", () => {
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

  it("tenant A reads ZERO rows of B's team / team_version / team_member / delegation_event", async () => {
    const a: TenantContext = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b: TenantContext = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    // A REAL team in tenant B, built by the real writers.
    const supervisor = await createFixtureAgentVersion(b, "triage");
    const billing = await createFixtureAgentVersion(b, "billing_agent");
    const route = await createFixtureRoute(b, mockModel.url);
    const created = await createTeamWithFirstVersion(
      b,
      {
        name: "support_team",
        artifact: teamArtifact("support_team", supervisor.pin, route.name, [
          { key: "billing", agent: billing.pin, delegationTier: "Tier1", invokeWhen: "billing questions", fallbackAction: "Escalate" },
        ]),
      },
      AUTHOR,
    );
    const members = await listTeamMembers(b, created.version.id);
    const { run } = await startAgentRun(b, { agentDefinitionVersionId: supervisor.versionId, trigger: "SandboxTest" });
    const event = await insertDelegationEvent(b, {
      conversationId: null,
      agentRunId: run.id,
      teamVersionId: created.version.id,
      parentDelegationEventId: null,
      parentSpanId: null,
      spanId: "span-b",
      depth: 1,
      siblingOrdinal: 0,
      fromAgentVersionId: supervisor.versionId,
      fromMemberId: null,
      toAgentVersionId: billing.versionId,
      toMemberId: members[0]!.id,
      toolCallId: null,
      reason: "B's private routing rationale",
      scopeHash: "b".repeat(64),
      outcome: "Answered",
      outcomeDetail: null,
      fallbackOfEventId: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: "0",
      latencyMs: 1,
      escalationId: null,
    });

    // --- Through the module's own read paths -------------------------------
    expect(await listTeams(a)).toEqual([]);
    expect(await findTeamById(a, created.team.id)).toBeNull();
    expect(await findTeamVersionById(a, created.version.id)).toBeNull();
    expect(await listTeamMembers(a, created.version.id)).toEqual([]);
    // Asking for B's REAL run id from A's context returns an empty forest, never
    // B's data — the RLS predicate makes the rows structurally invisible regardless
    // of which real id is asked for.
    expect((await getDelegationTree(a, run.id)).roots).toEqual([]);

    // --- And directly against the tables, bypassing every service ----------
    const rawTeams = await withTenant(a, (db) => db.select().from(schema.team).where(eq(schema.team.id, created.team.id)));
    const rawVersions = await withTenant(a, (db) => db.select().from(schema.teamVersion).where(eq(schema.teamVersion.id, created.version.id)));
    const rawMembers = await withTenant(a, (db) => db.select().from(schema.teamMember).where(eq(schema.teamMember.id, members[0]!.id)));
    const rawEvents = await withTenant(a, (db) => db.select().from(schema.delegationEvent).where(eq(schema.delegationEvent.id, event.id)));
    expect([rawTeams, rawVersions, rawMembers, rawEvents].map((r) => r.length)).toEqual([0, 0, 0, 0]);

    // B still sees its own rows — the isolation is a boundary, not a black hole.
    expect((await listTeams(b)).map((t) => t.id)).toEqual([created.team.id]);
    expect((await getDelegationTree(b, run.id)).roots).toHaveLength(1);
  });

  it("tenant A cannot WRITE a team_version into tenant B (the WITH CHECK half of the policy)", async () => {
    const a: TenantContext = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b: TenantContext = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const supervisor = await createFixtureAgentVersion(b, "triage");
    const billing = await createFixtureAgentVersion(b, "billing_agent");
    const route = await createFixtureRoute(b, mockModel.url);
    const created = await createTeamWithFirstVersion(
      b,
      {
        name: "support_team",
        artifact: teamArtifact("support_team", supervisor.pin, route.name, [
          { key: "billing", agent: billing.pin, delegationTier: "Tier1", invokeWhen: "billing questions", fallbackAction: "Escalate" },
        ]),
      },
      AUTHOR,
    );

    // A, acting in its own context, tries to stamp a row with B's tenant id.
    await expect(
      withTenant(a, (db) =>
        db.insert(schema.teamVersion).values({
          id: crypto.randomUUID(),
          tenantId: b.tenantId,
          teamId: created.team.id,
          version: 99,
          yaml: "y",
          yamlHash: "h",
          supervisorDefinitionVersionId: supervisor.versionId,
          supervisorRouteVersionId: route.routeVersionId,
          limitsJson: {},
          failureMode: "Escalate",
          scopeJson: {},
          createdByUserId: AUTHOR,
        }),
      ),
    ).rejects.toThrow();

    // …and nothing landed.
    const rows = await withTenant(b, (db) =>
      db.select().from(schema.teamVersion).where(and(eq(schema.teamVersion.tenantId, b.tenantId), eq(schema.teamVersion.version, 99))),
    );
    expect(rows).toHaveLength(0);
  });
});
