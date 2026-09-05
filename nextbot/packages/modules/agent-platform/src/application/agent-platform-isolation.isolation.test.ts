import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { startMockGitHubServer, createMockGitHubState } from "@nextbot/testing";
import { connectGit } from "./git-connection-service.js";
import { createAgentDefinition, createAgentDefinitionVersion } from "./agent-definition-service.js";
import { createEvalSuite } from "./eval-service.js";
import { createRoute } from "@nextbot/model-gateway";
import { startAgentRun } from "./agent-run-service.js";
import { createDraft } from "./studio-service.js";
import { createBlueprint } from "./blueprint-service.js";

const ARTIFACT = {
  apiVersion: "nextbot.io/v1" as const,
  kind: "AgentDefinition" as const,
  metadata: { name: "iso-target", version: "1.0.0" },
  spec: {
    graphType: "CustomFSM" as const,
    modelRoute: "chat.primary",
    instructions: "hi",
    toolPolicy: { source: "agent-tool-registry" as const, capabilityGroups: [], maxToolCallsPerTurn: 5 },
    guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
    memory: { strategy: "rolling-window", maxTurns: 20 },
    budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
  },
};

/** ADR-0001 §6 cross-tenant isolation proof for every genuinely tenant-scoped table
 * this phase adds (LLD §3.2 rule 1). `model_provider` is deliberately excluded — it
 * has no `tenant_id` column at all (platform-level reference data, see the schema's
 * module doc). */
describe("agent-platform tenant isolation (ADR-0001 §6 / LLD §3.2)", () => {
  const createdTenantIds: string[] = [];
  const servers: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
    for (const server of servers.splice(0)) await server.close();
  });

  it("a tenant scoped to A reads zero rows of B's git_connection", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);
    await connectGit(b, { provider: "GitHub", repoOwner: "acme", repoName: "b-repo", accessToken: "fake", createdByUserId: "11111111-1111-1111-1111-111111111111" });

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.gitConnection).where(eq(schema.gitConnection.tenantId, b.tenantId)));
    expect(rowsSeenByA).toHaveLength(0);
  });

  it("a tenant scoped to A reads zero rows of B's agent_definition/agent_definition_version", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);
    const server = await startMockGitHubServer(createMockGitHubState());
    servers.push(server);
    await connectGit(b, { provider: "GitHub", repoOwner: "acme", repoName: "b-repo", baseUrl: server.url, accessToken: "fake", createdByUserId: "11111111-1111-1111-1111-111111111111" });
    const definition = await createAgentDefinition(b, { name: "b-only-definition" });
    const version = await createAgentDefinitionVersion(b, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");

    const definitionsSeenByA = await withTenant(a, (db) => db.select().from(schema.agentDefinition).where(eq(schema.agentDefinition.id, definition.id)));
    const versionsSeenByA = await withTenant(a, (db) => db.select().from(schema.agentDefinitionVersion).where(eq(schema.agentDefinitionVersion.id, version.id)));
    expect(definitionsSeenByA).toHaveLength(0);
    expect(versionsSeenByA).toHaveLength(0);
  });

  it("a tenant scoped to A reads zero rows of B's eval_suite", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);
    const suite = await createEvalSuite(b, { name: "b-only-suite" });

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.evalSuite).where(eq(schema.evalSuite.id, suite.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });

  it("a tenant scoped to A reads zero rows of B's model_route", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);
    const route = await createRoute(b, { name: "chat.iso-test" });

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.modelRoute).where(eq(schema.modelRoute.id, route.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });

  it("a tenant scoped to A reads zero rows of B's agent_run", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);
    const server = await startMockGitHubServer(createMockGitHubState());
    servers.push(server);
    await connectGit(b, { provider: "GitHub", repoOwner: "acme", repoName: "b-repo", baseUrl: server.url, accessToken: "fake", createdByUserId: "11111111-1111-1111-1111-111111111111" });
    const definition = await createAgentDefinition(b, { name: "b-only-run-definition" });
    const version = await createAgentDefinitionVersion(b, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");
    const { run } = await startAgentRun(b, { agentDefinitionVersionId: version.id, trigger: "SandboxTest" });

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.agentRun).where(eq(schema.agentRun.id, run.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });

  // Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13/15) — the Studio's
  // scratch draft and the Blueprints Gallery's tenant-local templates.
  it("a tenant scoped to A reads zero rows of B's studio_draft", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);
    const definition = await createAgentDefinition(b, { name: "b-only-studio-definition" });
    const draft = await createDraft(b, definition.id, "11111111-1111-1111-1111-111111111111");

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.studioDraft).where(eq(schema.studioDraft.id, draft.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });

  it("a tenant scoped to A reads zero rows of B's agent_blueprint", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);
    const blueprint = await createBlueprint(b, { name: "b-only-blueprint", artifact: ARTIFACT }, null);

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.agentBlueprint).where(eq(schema.agentBlueprint.id, blueprint.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });
});
