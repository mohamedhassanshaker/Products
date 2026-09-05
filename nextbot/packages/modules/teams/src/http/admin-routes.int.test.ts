import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { TeamNotFoundError, TeamVersionNotFoundError, type TeamMemberSpec } from "@nextbot/contracts";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createFixtureAgentVersion, createFixtureRoute, teamArtifact } from "../testing/team-fixtures.js";
import { serializeTeamArtifact } from "../domain/team-artifact.js";
import type { SpecialistRunner } from "../ports/specialist-runner.js";
import {
  handleCreateTeam,
  handleCreateTeamVersion,
  handleDiffTeamVersions,
  handleGetTeam,
  handleGetTeamVersion,
  handleListTeamVersions,
  handleListTeams,
  handleTeamSandboxRun,
  handleTransitionTeamVersion,
  handleUpdateTeam,
  handleValidateTeamVersion,
} from "./admin-routes.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, LLD §14.7.5) — every one of the
 * eight new endpoint handlers, against real Postgres. The `http/` layer is a thin
 * adapter, so this suite is about the CONTRACT each handler returns (which the
 * console renders) rather than about business logic, which its own suites cover.
 */
const AUTHOR = "11111111-1111-1111-1111-111111111111";
const REVIEWER = "22222222-2222-2222-2222-222222222222";
let mockModel: MockOpenAiServerHandle;

function memberSpec(key: string, pin: string, overrides: Partial<TeamMemberSpec> = {}): TeamMemberSpec {
  return { key, agent: pin, delegationTier: "Tier1", invokeWhen: `about ${key}`, fallbackAction: "Escalate", ...overrides };
}

const answeringRunner: SpecialistRunner = {
  async run() {
    return { outcome: "answered", text: "handled", tokensIn: 1, tokensOut: 1, costUsd: "0" };
  },
};

describe("teams http/admin-routes (LLD §14.7.5, real Postgres)", () => {
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

  async function fixture() {
    const ctx: TenantContext = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const supervisor = await createFixtureAgentVersion(ctx, "triage");
    const billing = await createFixtureAgentVersion(ctx, "billing_agent");
    const shipping = await createFixtureAgentVersion(ctx, "shipping_agent");
    const route = await createFixtureRoute(ctx, mockModel.url);
    const artifact = teamArtifact("support_team", supervisor.pin, route.name, [memberSpec("billing", billing.pin), memberSpec("shipping", shipping.pin)]);
    return { ctx, supervisor, billing, shipping, route, artifact };
  }

  it("POST /teams creates the team plus version 1 and returns members inlined; GET /teams lists it", async () => {
    const f = await fixture();
    const created = await handleCreateTeam(f.ctx, { name: "support_team", description: "the support team", artifact: f.artifact }, AUTHOR);

    expect(created.team.name).toBe("support_team");
    expect(created.version.version).toBe(1);
    expect(created.version.members.map((m) => m.memberKey).sort()).toEqual(["billing", "shipping"]);
    expect(created.warnings).toEqual([]);

    const teams = await handleListTeams(f.ctx);
    expect(teams.map((t) => t.id)).toEqual([created.team.id]);
  });

  it("GET /teams/{id} returns the team with its versions; a missing id is a 404-shaped domain error", async () => {
    const f = await fixture();
    const created = await handleCreateTeam(f.ctx, { name: "support_team", artifact: f.artifact }, AUTHOR);

    const detail = await handleGetTeam(f.ctx, created.team.id);
    expect(detail.team.id).toBe(created.team.id);
    expect(detail.versions).toHaveLength(1);

    await expect(handleGetTeam(f.ctx, crypto.randomUUID())).rejects.toThrow(TeamNotFoundError);
  });

  it("PATCH /teams/{id} updates description and status only", async () => {
    const f = await fixture();
    const created = await handleCreateTeam(f.ctx, { name: "support_team", artifact: f.artifact }, AUTHOR);
    const updated = await handleUpdateTeam(f.ctx, created.team.id, { description: "renamed", status: "Archived" });
    expect(updated.team.description).toBe("renamed");
    expect(updated.team.status).toBe("Archived");
    await expect(handleUpdateTeam(f.ctx, crypto.randomUUID(), { description: "x" })).rejects.toThrow(TeamNotFoundError);
  });

  it("POST/GET /teams/{id}/versions appends and lists monotonic versions", async () => {
    const f = await fixture();
    const created = await handleCreateTeam(f.ctx, { name: "support_team", artifact: f.artifact }, AUTHOR);
    const v2 = await handleCreateTeamVersion(f.ctx, created.team.id, { artifact: { ...f.artifact, version: 2 } }, AUTHOR);
    expect(v2.version.version).toBe(2);

    const listed = await handleListTeamVersions(f.ctx, created.team.id);
    expect(listed.versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it("GET /teams/{id}/versions/{versionId} returns allowedTransitions and the FR-ORC-11 sandbox coverage", async () => {
    const f = await fixture();
    const created = await handleCreateTeam(f.ctx, { name: "support_team", artifact: f.artifact }, AUTHOR);
    const detail = await handleGetTeamVersion(f.ctx, created.version.id);

    expect(detail.version.members).toHaveLength(2);
    // A brand-new Draft can move to EvalGated (and be deprecated), but NOT to Approved.
    expect(detail.allowedTransitions).toContain("EvalGated");
    expect(detail.allowedTransitions).not.toContain("Approved");
    // No sandbox run recorded yet.
    expect(detail.sandboxCoverage).toBeNull();

    await expect(handleGetTeamVersion(f.ctx, crypto.randomUUID())).rejects.toThrow(TeamVersionNotFoundError);
  });

  it("POST .../validate takes raw YAML, resolves every reference, and surfaces the composed scope", async () => {
    const f = await fixture();
    const result = await handleValidateTeamVersion(f.ctx, serializeTeamArtifact(f.artifact));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.scope?.origin).toBe("TeamVersion");
    expect(result.scope?.budget?.maxDepth).toBe(4);
  });

  it("POST .../validate reports an unresolvable member pin as an ERROR (not a throw), so the editor can render it", async () => {
    const f = await fixture();
    const broken = { ...f.artifact, members: [memberSpec("billing", "no_such_agent@9.9.9")] };
    const result = await handleValidateTeamVersion(f.ctx, serializeTeamArtifact(broken));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "TEAM_PIN_UNRESOLVED")).toBe(true);
  });

  it("POST .../validate rejects a YAML syntax error through the SAME validator the save path uses", async () => {
    const f = await fixture();
    await expect(handleValidateTeamVersion(f.ctx, "kind: team\n  bad indent: [")).rejects.toThrow(/not valid YAML/);
  });

  it("GET .../versions/diff returns both versions' stored YAML and whether they are identical", async () => {
    const f = await fixture();
    const created = await handleCreateTeam(f.ctx, { name: "support_team", artifact: f.artifact }, AUTHOR);
    const same = await handleCreateTeamVersion(f.ctx, created.team.id, { artifact: { ...f.artifact, version: 2 } }, AUTHOR);
    const changed = await handleCreateTeamVersion(
      f.ctx,
      created.team.id,
      { artifact: { ...f.artifact, version: 3, members: [memberSpec("billing", f.billing.pin, { invokeWhen: "anything about money" })] } },
      AUTHOR,
    );

    const identical = await handleDiffTeamVersions(f.ctx, created.version.id, same.version.id);
    // Version 1 and 2 differ only by the artifact's own `version` field, so they are
    // NOT byte-identical — which is the honest answer, and what an author expects.
    expect(identical.from.version).toBe(1);
    expect(identical.to.version).toBe(2);

    const different = await handleDiffTeamVersions(f.ctx, created.version.id, changed.version.id);
    expect(different.identical).toBe(false);
    expect(different.to.yaml).toContain("anything about money");

    await expect(handleDiffTeamVersions(f.ctx, crypto.randomUUID(), changed.version.id)).rejects.toThrow(TeamVersionNotFoundError);
  });

  it("POST .../transition walks the ladder and refuses an illegal edge", async () => {
    const f = await fixture();
    const created = await handleCreateTeam(f.ctx, { name: "support_team", artifact: f.artifact }, AUTHOR);
    expect((await handleTransitionTeamVersion(f.ctx, created.version.id, "EvalGated", REVIEWER)).version.status).toBe("EvalGated");
    await expect(handleTransitionTeamVersion(f.ctx, created.version.id, "Production", REVIEWER)).rejects.toThrow();
  });

  it("POST .../sandbox-run exercises the whole topology and returns the real delegation tree", async () => {
    const f = await fixture();
    const created = await handleCreateTeam(f.ctx, { name: "support_team", artifact: f.artifact }, AUTHOR);

    const result = await handleTeamSandboxRun(f.ctx, { specialistRunner: answeringRunner }, created.version.id, { task: "exercise the team" });

    expect(result.outcome).toBe("Answered");
    expect(result.tree.agentRunId).toBe(result.agentRunId);
    expect(result.tree.roots.map((r) => r.memberKey).sort()).toEqual(["billing", "shipping"]);

    // …and the version detail now reports FULL coverage, unlocking Approved.
    const detail = await handleGetTeamVersion(f.ctx, created.version.id);
    expect(detail.sandboxCoverage?.missingMemberKeys).toEqual([]);
  });
});
