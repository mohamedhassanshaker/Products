import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { startMockGitHubServer, createMockGitHubState } from "@nextbot/testing";
import { handleConnectGit, handleCreateDefinition, handleCreateVersion, handleCreateEvalSuite, handleGetVersion } from "@nextbot/agent-platform";

/**
 * Integration-level regression test for the QA-reported defect (retry 3): a real HTTP
 * `POST` to `bind-eval-suite`, backed by a real (test) Postgres database and a real,
 * freshly-provisioned eval suite id (UUIDv7, generated app-side the same way
 * `createEvalSuite` does for every real request), must succeed end-to-end — not just
 * return 200, but actually persist the binding so it survives a re-fetch ("visible on
 * reload").
 *
 * Unlike `route.test.ts` (unit-level, mocks `@nextbot/agent-platform` entirely), this
 * test exercises the *real* `handleBindEvalSuite` -> `bindEvalSuite` -> real DB write
 * path, so it reproduces the exact live repro QA ran: "real HTTP POST to
 * bind-eval-suite with a genuine v7 id -> 422" would show up here as this test failing
 * with a 422 instead of 200, and a persistence bug (200 returned but nothing written)
 * would show up as the re-fetch assertion failing.
 *
 * Only the session/auth layer is mocked (real login/cookies are out of scope for this
 * defect and require a running auth flow this test doesn't need) — everything else,
 * including RBAC evaluation (`@nextbot/iam`'s `requirePermission`, pure domain logic,
 * not mocked) and the eval-suite/bind-eval-suite service calls, is real.
 *
 * Requires the test Postgres stack (`compose.test.yml`) to be up and `.env.test`
 * populated — same precondition as every other `*.int.test.ts` in this workspace.
 */

// "server-only" (imported transitively by "@/src/lib/api-guard") throws unless
// imported through Next's own webpack build; vitest has no such build step.
vi.mock("server-only", () => ({}));

describe("POST /api/v1/admin/agent-platform/versions/[id]/bind-eval-suite (integration: real DB, real UUIDv7 eval suite id)", () => {
  let ctx: TenantContext;
  let githubServer: { url: string; close: () => Promise<void> };
  const actingUserId = "11111111-1111-1111-1111-111111111111";

  beforeAll(async () => {
    ctx = await createFixtureTenant();
    githubServer = await startMockGitHubServer(createMockGitHubState());

    // Mock only the session/auth seam — everything downstream of it (RBAC check,
    // service calls, DB writes) runs for real against the fixture tenant created
    // above. `vi.doMock` (not `vi.mock`, which is hoisted) is used because `ctx` isn't
    // assigned until this `beforeAll` runs.
    vi.doMock("@/src/lib/session", () => ({
      getSession: async () => ({ permissions: { agent_platform: "Write" }, tenantId: ctx.tenantId }),
      getSessionTenantContext: async () => ctx,
    }));

    await handleConnectGit(ctx, { provider: "GitHub", repoOwner: "acme", repoName: "agent-defs", baseUrl: githubServer.url, accessToken: "fake-token" }, actingUserId);
  });

  afterAll(async () => {
    await githubServer.close();
    await deleteFixtureTenant(ctx.tenantId);
    vi.doUnmock("@/src/lib/session");
  });

  it("binds a real, freshly-generated UUIDv7 eval suite id via the real POST handler and persists it (visible on re-fetch)", async () => {
    const definition = await handleCreateDefinition(ctx, { name: "bind-eval-suite-int-test" });
    const version = await handleCreateVersion(
      ctx,
      definition.id,
      {
        version: "1.0.0",
        modelRouteKey: "chat.primary",
        graphType: "CustomFSM",
        artifact: {
          apiVersion: "nextbot.io/v1",
          kind: "AgentDefinition",
          metadata: { name: "bind-eval-suite-int-test", version: "1.0.0" },
          spec: {
            graphType: "CustomFSM",
            modelRoute: "chat.primary",
            instructions: "hi",
            toolPolicy: { source: "agent-tool-registry", capabilityGroups: [], maxToolCallsPerTurn: 5 },
            guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
            memory: { strategy: "rolling-window", maxTurns: 20 },
            budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
          },
        },
      },
      actingUserId,
    );

    // Provisioned via the real service — this is a genuine UUIDv7, generated
    // app-side by `generateId()` the exact same way every other primary key in the
    // system is, not a hand-picked example.
    const suite = await handleCreateEvalSuite(ctx, { name: "golden-int-test" });
    expect(suite.id[14]).toBe("7"); // sanity: genuinely a v7 id, reproducing the live defect's shape

    const { POST } = await import("./route.js");
    const request = new NextRequest(`http://localhost/api/v1/admin/agent-platform/versions/${version.id}/bind-eval-suite`, {
      method: "POST",
      body: JSON.stringify({ evalSuiteId: suite.id }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(request, { params: Promise.resolve({ id: version.id }) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Persistence check — a "200 but nothing written" bug would be invisible without
    // this re-fetch, which is exactly the browser's "reload the page" equivalent.
    const reloaded = await handleGetVersion(ctx, version.id, actingUserId);
    expect(reloaded.evalSuiteId).toBe(suite.id);
  });

  it("still rejects a genuinely malformed evalSuiteId with 422 against the real route, without touching the DB", async () => {
    const definition = await handleCreateDefinition(ctx, { name: "bind-eval-suite-int-test-reject" });
    const version = await handleCreateVersion(
      ctx,
      definition.id,
      {
        version: "1.0.0",
        modelRouteKey: "chat.primary",
        graphType: "CustomFSM",
        artifact: {
          apiVersion: "nextbot.io/v1",
          kind: "AgentDefinition",
          metadata: { name: "bind-eval-suite-int-test-reject", version: "1.0.0" },
          spec: {
            graphType: "CustomFSM",
            modelRoute: "chat.primary",
            instructions: "hi",
            toolPolicy: { source: "agent-tool-registry", capabilityGroups: [], maxToolCallsPerTurn: 5 },
            guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
            memory: { strategy: "rolling-window", maxTurns: 20 },
            budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
          },
        },
      },
      actingUserId,
    );

    const { POST } = await import("./route.js");
    const request = new NextRequest(`http://localhost/api/v1/admin/agent-platform/versions/${version.id}/bind-eval-suite`, {
      method: "POST",
      body: JSON.stringify({ evalSuiteId: "not-a-real-uuid-at-all" }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(request, { params: Promise.resolve({ id: version.id }) });
    expect(res.status).toBe(422);

    const reloaded = await handleGetVersion(ctx, version.id, actingUserId);
    expect(reloaded.evalSuiteId ?? null).toBeNull();
  });
});
