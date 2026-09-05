import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { generateId } from "@nextbot/db";
import { handleCreateDefinition, handleCreateVersion, listDefinitions, listAgentDefinitionVersions } from "@nextbot/agent-platform";
import { createSkill, listSkillsForLibrary, listVersions as listSkillVersions } from "@nextbot/skills";
import { createWorkflow, listWorkflowsForAdmin, listVersions as listWorkflowVersions } from "@nextbot/workflows";
import { createTeamWithFirstVersion, listTeamsForAdmin, listTeamVersions } from "@nextbot/teams";
import { createProviderRegistration, declareCatalogEntry, createRoute, createRouteVersion, listRoutes, listVersionsForRoute } from "@nextbot/model-gateway";
import { createConnector, listConnectors } from "@nextbot/connectors";

vi.mock("server-only", () => ({}));

const testUserId = generateId();

let ctx: TenantContext;
let ctxOther: TenantContext;
afterEach(async () => {
  if (ctx) await deleteFixtureTenant(ctx.tenantId);
  if (ctxOther) await deleteFixtureTenant(ctxOther.tenantId);
  vi.doUnmock("@/src/lib/session");
  vi.resetModules();
});

/** Mocks the session/auth seam only (same convention every admin-route integration
 * test in this codebase uses) — everything downstream is real Postgres. */
function mockSessionFor(tenantCtx: TenantContext, level: "Read" | "Write" | "None") {
  vi.doMock("@/src/lib/session", () => ({
    getSession: async () =>
      level === "None"
        ? { permissions: {}, tenantId: tenantCtx.tenantId, userId: testUserId, roleIds: [] }
        : { permissions: { security_settings: level }, tenantId: tenantCtx.tenantId, userId: testUserId, roleIds: ["role-1"] },
    getSessionTenantContext: async () => tenantCtx,
  }));
}

function agentArtifact(name: string) {
  return {
    apiVersion: "nextbot.io/v1" as const,
    kind: "AgentDefinition" as const,
    metadata: { name, version: "1.0.0" },
    spec: {
      graphType: "CustomFSM" as const,
      modelRoute: "chat.primary",
      instructions: `Instructions for ${name}.`,
      toolPolicy: { source: "agent-tool-registry" as const, capabilityGroups: [], maxToolCallsPerTurn: 5 },
      guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
      memory: { strategy: "rolling-window", maxTurns: 20 },
      budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
    },
  };
}

/** Seeds one of every restorable artifact kind into `tenantCtx`, real rows through
 * each module's own public creation API (never hand-inserted). Returns the seeded
 * identifiers so the test can assert against them after export/restore. */
async function seedFullTenantConfig(tenantCtx: TenantContext) {
  const definition = await handleCreateDefinition(tenantCtx, { name: "def_export_test" });
  await handleCreateVersion(tenantCtx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", artifact: agentArtifact("def_export_test") }, testUserId);

  const specialistDefinition = await handleCreateDefinition(tenantCtx, { name: "def_specialist_test" });
  await handleCreateVersion(tenantCtx, specialistDefinition.id, { version: "1.0.0", modelRouteKey: "chat.primary", artifact: agentArtifact("def_specialist_test") }, testUserId);

  await createSkill(
    tenantCtx,
    {
      name: "refund_request_export_test",
      artifact: {
        kind: "skill",
        name: "refund_request_export_test",
        version: 1,
        trigger: "customer asks for a refund",
        scope: { capabilityGroups: [], tools: [], knowledge: [] },
        instructions: "Confirm the invoice before refunding.",
        successCriteria: "refund issued",
        escalateWhen: [],
        evalCases: [],
      },
    },
    testUserId,
  );

  await createWorkflow(
    tenantCtx,
    {
      name: "wf_export_test",
      artifact: {
        apiVersion: "nextbot.io/v1",
        kind: "Workflow",
        metadata: { name: "wf_export_test", version: 1 },
        spec: {
          nodes: [
            { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "end_1" },
            { id: "end_1", kind: "End", outcome: "Resolved" },
          ],
          runLimits: { maxSteps: 50, maxCostUsd: 5, maxWallClockSeconds: 300, maxLoopIterations: 20, maxParallelBranches: 4, maxSubWorkflowDepth: 4 },
        },
      },
    },
    testUserId,
  );

  // Team needs a real chat.router route (FR-ORC-03) — real provider/catalog/route
  // rows through model-gateway's own public API.
  const provider = await createProviderRegistration(tenantCtx, {
    type: "openai-compatible",
    name: `Provider ${generateId().slice(0, 8)}`,
    baseUrl: "https://example.test/v1",
    region: tenantCtx.region,
    retainsPrompts: false,
    trainsOnData: false,
  });
  const catalogEntry = await declareCatalogEntry(tenantCtx, {
    providerId: provider.id,
    modelId: "router-test-model",
    displayName: "Router Test Model",
    modality: "Text",
    contextWindow: 8192,
    maxOutput: 4096,
    capabilities: { toolCalling: false, vision: false, streaming: false, structuredOutput: true, extendedThinking: false, promptCaching: false, jsonMode: true },
    tokenizer: "cl100k_base",
    priceIn: 0.0000005,
    priceOut: 0.0000015,
  });
  const routerRoute = await createRoute(tenantCtx, { name: "chat.router", role: "chat.router" });
  await createRouteVersion(
    tenantCtx,
    routerRoute.id,
    {
      chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: catalogEntry.id, params: {}, timeoutMs: 30000 }],
      policy: { strategy: "FixedPriority", failoverOn: ["429", "5xx", "timeout"], retry: { maxPerHop: 1, backoff: "exponential" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
    },
    true,
  );

  await createTeamWithFirstVersion(
    tenantCtx,
    {
      name: "team_export_test",
      artifact: {
        kind: "team",
        name: "team_export_test",
        version: 1,
        supervisor: { agent: "def_export_test@1.0.0", route: "chat.router" },
        limits: { maxDepth: 4, maxFanOut: 8, maxDelegations: 12, runBudget: { usd: 100, seconds: 600 }, thrashWindow: { repeats: 2, similarityThreshold: 0.9 } },
        failureMode: "Escalate",
        members: [
          {
            key: "specialist",
            agent: "def_specialist_test@1.0.0",
            delegationTier: "Tier1",
            invokeWhen: "the customer needs a refund",
          },
        ],
      },
    },
    testUserId,
  );

  // A second, dedicated custom route for the export/restore assertions themselves
  // (distinct from the team's own chat.router route, so restoring it doesn't
  // interact with the team fixture above).
  const exportRoute = await createRoute(tenantCtx, { name: "custom.export.route", role: "custom" });
  await createRouteVersion(
    tenantCtx,
    exportRoute.id,
    {
      chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: catalogEntry.id, params: {}, timeoutMs: 30000 }],
      policy: { strategy: "FixedPriority", failoverOn: ["429", "5xx", "timeout"], retry: { maxPerHop: 1, backoff: "exponential" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
    },
    false,
  );

  // Two connectors: one restorable (no credential), one deliberately credentialed
  // (must NEVER leak its secret material and must never be auto-restored).
  await createConnector(tenantCtx, {
    name: "billing_none_auth_export_test",
    backendType: "Custom",
    transport: "StreamableHTTP",
    endpointUrl: "https://billing.example.com/mcp",
    authMethod: "None",
    environment: "Sandbox",
  });
  await createConnector(tenantCtx, {
    name: "billing_secret_export_test",
    backendType: "Custom",
    transport: "StreamableHTTP",
    endpointUrl: "https://billing-secure.example.com/mcp",
    authMethod: "APIKey",
    environment: "Sandbox",
    credentialPlaintext: "sk-live-super-secret-do-not-leak-1234567890",
  });
}

describe("Configuration Export & Restore (Phase 19, BL-51, FR-ADM-08, real Postgres)", () => {
  it("GET export 403s without security_settings=Read", async () => {
    ctx = await createFixtureTenant();
    mockSessionFor(ctx, "None");
    const { GET } = await import("./export/route.js");
    expect((await GET()).status).toBe(403);
  });

  it("exports every seeded artifact kind, never leaks credential material, and a restore of the SAME bundle into the SAME tenant creates new Draft versions/rows rather than overwriting", async () => {
    ctx = await createFixtureTenant();
    await seedFullTenantConfig(ctx);
    mockSessionFor(ctx, "Write");

    const { GET } = await import("./export/route.js");
    const exportRes = await GET();
    expect(exportRes.status).toBe(200);
    const bundle = await exportRes.json();

    // --- Manifest / structural sanity ---
    const manifestNames = bundle.manifest.map((m: { name: string }) => m.name);
    expect(manifestNames).toEqual(
      expect.arrayContaining([
        "def_export_test",
        "def_specialist_test",
        "refund_request_export_test",
        "wf_export_test",
        "team_export_test",
        "custom.export.route",
        "billing_none_auth_export_test",
        "billing_secret_export_test",
      ]),
    );

    // --- Security-critical: no credential material anywhere in the serialized bundle ---
    const rawJson = JSON.stringify(bundle);
    expect(rawJson).not.toContain("sk-live-super-secret-do-not-leak-1234567890");
    expect(rawJson.toLowerCase()).not.toContain("ciphertext");
    const secretConnector = bundle.artifacts.connectors.find((c: { name: string }) => c.name === "billing_secret_export_test");
    expect(secretConnector).toBeDefined();
    expect(Object.keys(secretConnector)).not.toContain("credentialId");
    expect(Object.keys(secretConnector)).not.toContain("credentialPlaintext");

    // --- Byte-faithful capture: the exported YAML matches the real, currently-stored version content ---
    const realAgentVersions = await listAgentDefinitionVersions(ctx, (await listDefinitions(ctx)).find((d) => d.name === "def_export_test")!.id);
    const exportedAgent = bundle.artifacts.agentDefinitions.find((a: { name: string }) => a.name === "def_export_test");
    expect(exportedAgent.artifactYaml).toBe(realAgentVersions[0]!.definitionYaml);

    // --- Restore preview: zero writes, and restoring into the SAME tenant that
    // already has these exact identities must plan a NEW DRAFT VERSION under the
    // EXISTING identity (never "overwrite"), and must SKIP the no-credential
    // connector because a connector of that name already exists.
    const { POST } = await import("./restore/route.js");
    const previewRes = await POST(new NextRequest("http://localhost/api/v1/admin/config-portability/restore", { method: "POST", body: JSON.stringify({ bundle, mode: "preview" }) }));
    expect(previewRes.status).toBe(200);
    const previewBody = await previewRes.json();
    const previewOutcomes: Array<{ kind: string; name: string; action: string; reason?: string }> = previewBody.outcomes;

    function outcomeFor(kind: string, name: string) {
      const found = previewOutcomes.find((o) => o.kind === kind && o.name === name);
      expect(found).toBeDefined();
      return found!;
    }
    expect(outcomeFor("AgentDefinition", "def_export_test").action).toBe("createdNewDraftVersion");
    expect(outcomeFor("Skill", "refund_request_export_test").action).toBe("createdNewDraftVersion");
    expect(outcomeFor("Workflow", "wf_export_test").action).toBe("createdNewDraftVersion");
    expect(outcomeFor("Team", "team_export_test").action).toBe("createdNewDraftVersion");
    expect(outcomeFor("ModelRoute", "custom.export.route").action).toBe("createdNewDraftVersion");
    expect(outcomeFor("Connector", "billing_none_auth_export_test").action).toBe("skipped");
    expect(outcomeFor("Connector", "billing_secret_export_test").action).toBe("skipped");
    expect(outcomeFor("Policy", "Tenant policy configuration").action).toBe("skipped");

    // Preview must be a genuine dry run — nothing written yet.
    expect((await listAgentDefinitionVersions(ctx, (await listDefinitions(ctx)).find((d) => d.name === "def_export_test")!.id)).length).toBe(1);

    // --- Restore confirm: the real write ---
    const confirmRes = await POST(new NextRequest("http://localhost/api/v1/admin/config-portability/restore", { method: "POST", body: JSON.stringify({ bundle, mode: "confirm" }) }));
    expect(confirmRes.status).toBe(200);
    const confirmBody = await confirmRes.json();
    const confirmOutcomes: Array<{ kind: string; name: string; action: string; newVersionId?: string }> = confirmBody.outcomes;
    function confirmedFor(kind: string, name: string) {
      const found = confirmOutcomes.find((o) => o.kind === kind && o.name === name);
      expect(found).toBeDefined();
      return found!;
    }

    // Agent: a real second version, Draft, byte-identical YAML, original v1 untouched.
    const agentDefId = (await listDefinitions(ctx)).find((d) => d.name === "def_export_test")!.id;
    const agentVersionsAfter = await listAgentDefinitionVersions(ctx, agentDefId);
    expect(agentVersionsAfter.length).toBe(2);
    const newAgentVersion = agentVersionsAfter.find((v) => v.id === confirmedFor("AgentDefinition", "def_export_test").newVersionId)!;
    expect(newAgentVersion.status).toBe("Draft");
    expect(newAgentVersion.definitionYaml).toBe(exportedAgent.artifactYaml);
    expect(newAgentVersion.version).not.toBe("1.0.0");
    const originalAgentVersion = agentVersionsAfter.find((v) => v.version === "1.0.0")!;
    expect(originalAgentVersion.definitionYaml).toBe(exportedAgent.artifactYaml); // untouched, never overwritten

    // Skill: a real version 2, Draft.
    const skillId = (await listSkillsForLibrary(ctx)).find((s) => s.name === "refund_request_export_test")!.id;
    const skillVersionsAfter = await listSkillVersions(ctx, skillId);
    expect(skillVersionsAfter.length).toBe(2);
    expect(skillVersionsAfter.find((v) => v.version === 2)!.status).toBe("Draft");

    // Workflow: a real version 2, Draft.
    const workflowId = (await listWorkflowsForAdmin(ctx)).find((w) => w.name === "wf_export_test")!.id;
    const workflowVersionsAfter = await listWorkflowVersions(ctx, workflowId);
    expect(workflowVersionsAfter.length).toBe(2);
    expect(workflowVersionsAfter.find((v) => v.version === 2)!.status).toBe("Draft");

    // Team: a real version 2, Draft.
    const teamId = (await listTeamsForAdmin(ctx)).find((t) => t.name === "team_export_test")!.id;
    const teamVersionsAfter = await listTeamVersions(ctx, teamId);
    expect(teamVersionsAfter.length).toBe(2);
    expect(teamVersionsAfter.find((v) => v.version === 2)!.status).toBe("Draft");

    // Model route: a real version 2, Draft — NEVER Published, even though this
    // kind's own promotion ladder (Draft/Published) is shorter than the other
    // four's.
    const routeId = (await listRoutes(ctx)).find((r) => r.name === "custom.export.route")!.id;
    const routeVersionsAfter = await listVersionsForRoute(ctx, routeId);
    expect(routeVersionsAfter.length).toBe(2);
    expect(routeVersionsAfter.find((v) => v.version === 2)!.status).toBe("Draft");

    // Connectors: never a second row (never overwritten) — still exactly one of each.
    const connectorsAfter = await listConnectors(ctx);
    expect(connectorsAfter.filter((c) => c.name === "billing_none_auth_export_test").length).toBe(1);
    expect(connectorsAfter.filter((c) => c.name === "billing_secret_export_test").length).toBe(1);
  });

  it("rejects restoring a bundle into a DIFFERENT tenant than it was exported from (422, RESTORE_CROSS_TENANT_NOT_SUPPORTED)", async () => {
    ctx = await createFixtureTenant();
    await seedFullTenantConfig(ctx);
    ctxOther = await createFixtureTenant();

    mockSessionFor(ctx, "Write");
    const { GET } = await import("./export/route.js");
    const bundle = await (await GET()).json();

    // A fresh module graph is required before re-mocking the session seam to a
    // DIFFERENT tenant within the same test — `vi.doMock` only takes effect for
    // modules not yet cached in this test's module registry, and `api-guard.ts`
    // (imported transitively by `./export/route.js` above) is already cached with
    // the FIRST mock's live bindings otherwise.
    vi.resetModules();
    mockSessionFor(ctxOther, "Write");
    const { POST } = await import("./restore/route.js");
    const res = await POST(new NextRequest("http://localhost/api/v1/admin/config-portability/restore", { method: "POST", body: JSON.stringify({ bundle, mode: "preview" }) }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("RESTORE_CROSS_TENANT_NOT_SUPPORTED");
  });
});
