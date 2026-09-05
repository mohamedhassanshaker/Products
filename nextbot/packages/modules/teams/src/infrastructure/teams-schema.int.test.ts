import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, schema, withTenant, type TenantContext } from "@nextbot/db";
import { and, eq, sql } from "drizzle-orm";
import { createFixtureAgentVersion, createFixtureRoute } from "../testing/team-fixtures.js";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { hashTeamArtifact } from "../domain/team-artifact.js";
import { insertTeamVersion, setTeamVersionStatus } from "./team-repository.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01/03, LLD §14.7.1/§14.7.2)
 * — the DATABASE-level half of this phase's invariants, proven against real
 * Postgres. Everything asserted here is enforced by the engine, not by application
 * code, so a raw-SQL path cannot bypass it either.
 */
const SYSTEM_USER = "11111111-1111-1111-1111-111111111111";
const LIMITS = { maxDepth: 2, maxFanOut: 2, maxDelegations: 4, runBudget: { usd: 1, seconds: 60 }, thrashWindow: { repeats: 2, similarityThreshold: 0.9 } };

let mockModel: MockOpenAiServerHandle | undefined;
async function modelUrl(): Promise<string> {
  mockModel ??= await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "{}" }) });
  return mockModel.url;
}

describe("Module E schema (real Postgres)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  async function fixture(): Promise<{ ctx: TenantContext; teamId: string; supervisorVersionId: string; routeVersionId: string; specialistVersionId: string; toolId: string }> {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const supervisor = await createFixtureAgentVersion(ctx, "triage");
    const specialist = await createFixtureAgentVersion(ctx, "billing_agent");
    const route = await createFixtureRoute(ctx, await modelUrl());

    const teamId = generateId();
    await withTenant(ctx, (db) =>
      db.insert(schema.team).values({ id: teamId, tenantId: ctx.tenantId, name: "support_team", createdByUserId: SYSTEM_USER }),
    );
    // A real AgentAsTool row, minted the way the registrar does.
    const toolId = generateId();
    await withTenant(ctx, (db) =>
      db.insert(schema.tool).values({
        id: toolId,
        tenantId: ctx.tenantId,
        connectorId: null,
        kind: "AgentAsTool",
        agentDefinitionVersionId: specialist.versionId,
        name: "agent.billing_agent",
        descriptionSource: "delegate",
        rwClass: "Write",
        rwClassSource: "AutoHeuristic",
        approvalTier: "Tier1",
        approvalTierSource: "BackendTypeDefault",
      }),
    );
    return { ctx, teamId, supervisorVersionId: supervisor.versionId, routeVersionId: route.routeVersionId, specialistVersionId: specialist.versionId, toolId };
  }

  it("FR-ORC-03: inserting a team_version with NO failure_mode is a CONSTRAINT violation, not a defaulted row", async () => {
    const f = await fixture();
    await expect(
      // Raw SQL deliberately: the point is that even bypassing the repository
      // (which always supplies 'Escalate'), the column has NO DEFAULT, so the
      // engine itself refuses the row.
      withTenant(f.ctx, (db) =>
        db.execute(sql`
          INSERT INTO team_version (id, tenant_id, team_id, version, yaml, yaml_hash,
            supervisor_definition_version_id, supervisor_route_version_id, limits_json,
            scope_json, created_by_user_id)
          VALUES (${generateId()}, ${f.ctx.tenantId}, ${f.teamId}, 1, 'yaml', 'hash',
            ${f.supervisorVersionId}, ${f.routeVersionId}, '{}'::jsonb, '{}'::jsonb, ${SYSTEM_USER})`),
      ),
    ).rejects.toThrow(/failure_mode/i);
  });

  it("team_version is IMMUTABLE — the trigger rejects a change to any authored column", async () => {
    const f = await fixture();
    const { version } = await insertTeamVersion(f.ctx, {
      teamId: f.teamId,
      yaml: "kind: team",
      yamlHash: hashTeamArtifact({ kind: "team" }),
      supervisorDefinitionVersionId: f.supervisorVersionId,
      supervisorRouteVersionId: f.routeVersionId,
      limitsJson: LIMITS,
      scopeJson: { origin: "TeamVersion", originId: "x", originLabel: "x" },
      createdByUserId: SYSTEM_USER,
      members: [],
    });

    await expect(
      withTenant(f.ctx, (db) => db.execute(sql`UPDATE team_version SET yaml = 'tampered' WHERE id = ${version.id}`)),
    ).rejects.toThrow(/TEAM_VERSION_IMMUTABLE/);

    // …but the promotion-ladder columns the repository legitimately sets still work.
    const promoted = await setTeamVersionStatus(f.ctx, version.id, "EvalGated");
    expect(promoted?.status).toBe("EvalGated");

    // And the stored hash still matches the stored yaml — layer 3 of the
    // three-layer immutability enforcement.
    const stored = await withTenant(f.ctx, (db) =>
      db.select().from(schema.teamVersion).where(eq(schema.teamVersion.id, version.id)),
    );
    expect(stored[0]?.yaml).toBe("kind: team");
    expect(stored[0]?.yamlHash).toBe(hashTeamArtifact({ kind: "team" }));
  });

  it("team_member is immutable outright — a member change must mint a new team_version", async () => {
    const f = await fixture();
    const { members } = await insertTeamVersion(f.ctx, {
      teamId: f.teamId,
      yaml: "kind: team",
      yamlHash: "h",
      supervisorDefinitionVersionId: f.supervisorVersionId,
      supervisorRouteVersionId: f.routeVersionId,
      limitsJson: LIMITS,
      scopeJson: {},
      createdByUserId: SYSTEM_USER,
      members: [
        {
          memberKey: "billing",
          definitionVersionId: f.specialistVersionId,
          toolId: f.toolId,
          delegationTier: "Tier1",
          invokeWhen: "billing questions",
          scopeJson: {},
          fallbackAction: "Escalate",
          fallbackMemberKey: null,
          ordinal: 0,
        },
      ],
    });
    await expect(
      withTenant(f.ctx, (db) => db.execute(sql`UPDATE team_member SET invoke_when = 'anything' WHERE id = ${members[0]!.id}`)),
    ).rejects.toThrow(/TEAM_MEMBER_IMMUTABLE/);
  });

  it("team_version_approver_distinct: the author cannot be recorded as the approver", async () => {
    const f = await fixture();
    const { version } = await insertTeamVersion(f.ctx, {
      teamId: f.teamId,
      yaml: "y",
      yamlHash: "h",
      supervisorDefinitionVersionId: f.supervisorVersionId,
      supervisorRouteVersionId: f.routeVersionId,
      limitsJson: LIMITS,
      scopeJson: {},
      createdByUserId: SYSTEM_USER,
      members: [],
    });
    await expect(setTeamVersionStatus(f.ctx, version.id, "Approved", SYSTEM_USER)).rejects.toThrow();
    const other = await setTeamVersionStatus(f.ctx, version.id, "Approved", "22222222-2222-2222-2222-222222222222");
    expect(other?.approvedByUserId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("version ordinals are monotonic per (tenant, team) and a duplicate is refused by the unique index", async () => {
    const f = await fixture();
    const base = {
      teamId: f.teamId,
      yaml: "y",
      yamlHash: "h",
      supervisorDefinitionVersionId: f.supervisorVersionId,
      supervisorRouteVersionId: f.routeVersionId,
      limitsJson: LIMITS,
      scopeJson: {},
      createdByUserId: SYSTEM_USER,
      members: [],
    };
    const first = await insertTeamVersion(f.ctx, base);
    const second = await insertTeamVersion(f.ctx, base);
    expect(first.version.version).toBe(1);
    expect(second.version.version).toBe(2);
    await expect(insertTeamVersion(f.ctx, { ...base, version: 2 })).rejects.toThrow();
  });
});

describe("tool.kind CHECK constraints (FR-ORC-01, LLD §14.7.1) — real Postgres", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("an McpTool MUST have a connector, and an AgentAsTool must NOT", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const specialist = await createFixtureAgentVersion(ctx, "billing_agent");

    // McpTool with no connector -> refused.
    await expect(
      withTenant(ctx, (db) =>
        db.insert(schema.tool).values({
          id: generateId(),
          tenantId: ctx.tenantId,
          connectorId: null,
          kind: "McpTool",
          name: "bad_mcp_tool",
          descriptionSource: "x",
          rwClass: "Read",
          rwClassSource: "AutoHeuristic",
          approvalTier: "Tier1",
          approvalTierSource: "BackendTypeDefault",
        }),
      ),
    ).rejects.toThrow(/tool_kind_connector_consistency/);

    // AgentAsTool with no pinned agent version -> refused.
    await expect(
      withTenant(ctx, (db) =>
        db.insert(schema.tool).values({
          id: generateId(),
          tenantId: ctx.tenantId,
          connectorId: null,
          kind: "AgentAsTool",
          agentDefinitionVersionId: null,
          name: "agent.nothing",
          descriptionSource: "x",
          rwClass: "Write",
          rwClassSource: "AutoHeuristic",
          approvalTier: "Tier1",
          approvalTierSource: "BackendTypeDefault",
        }),
      ),
    ).rejects.toThrow(/tool_kind_agent_version_consistency/);

    // The valid AgentAsTool shape is accepted.
    const toolId = generateId();
    await withTenant(ctx, (db) =>
      db.insert(schema.tool).values({
        id: toolId,
        tenantId: ctx.tenantId,
        connectorId: null,
        kind: "AgentAsTool",
        agentDefinitionVersionId: specialist.versionId,
        name: "agent.billing_agent",
        descriptionSource: "x",
        rwClass: "Write",
        rwClassSource: "AutoHeuristic",
        approvalTier: "Tier1",
        approvalTierSource: "BackendTypeDefault",
      }),
    );
    const rows = await withTenant(ctx, (db) =>
      db.select().from(schema.tool).where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, toolId))),
    );
    expect(rows[0]?.kind).toBe("AgentAsTool");
    expect(rows[0]?.connectorId).toBeNull();
  });

  it("only ONE AgentAsTool row may exist per pinned specialist version (partial unique index)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const specialist = await createFixtureAgentVersion(ctx, "billing_agent");
    const insert = (name: string) =>
      withTenant(ctx, (db) =>
        db.insert(schema.tool).values({
          id: generateId(),
          tenantId: ctx.tenantId,
          connectorId: null,
          kind: "AgentAsTool",
          agentDefinitionVersionId: specialist.versionId,
          name,
          descriptionSource: "x",
          rwClass: "Write",
          rwClassSource: "AutoHeuristic",
          approvalTier: "Tier1",
          approvalTierSource: "BackendTypeDefault",
        }),
      );
    await insert("agent.billing_agent");
    // A DIFFERENT name, same pinned version — still refused, because the invariant is
    // one catalog entry per pinned version, not per name.
    await expect(insert("agent.billing_agent_copy")).rejects.toThrow(/tool_tenant_agent_version_key/);
  });
});
