import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { resolveTenantById } from "@nextbot/tenancy";
import { seedSystemRoles, createServiceAccount, issueApiKey } from "@nextbot/iam";
import type { TenantContext } from "@nextbot/db";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-API-01) — the plan doc's own exit
 * gate: "confirmation that scoped-key auth applies the same RBAC gating as the
 * console for every exposed surface." This test proves `requirePublicApi()` end to
 * end against a REAL service account, a REAL issued `nbk_…` key, and the REAL
 * `verifyApiKey()`/`requirePermission()` path — nothing about the auth/RBAC layer is
 * mocked.
 *
 * `next/headers`'s `cookies()`/`headers()` are the ONLY seam replaced (same class of
 * mock every other `apps/web` route-handler integration test in this codebase applies
 * to `next/headers`/`server-only`, since those Next.js runtime primitives only work
 * inside a real request the framework itself dispatches, not a function called
 * directly from a test process) — everything downstream (`getAuthContext`,
 * `verifyApiKey`, `requirePermission`, `getSessionTenantContext`) is the real
 * production code path, backed by a real (test) Postgres database.
 */
vi.mock("server-only", () => ({}));

describe("requirePublicApi() — bearer-key RBAC parity with the console (real Postgres, real verifyApiKey)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
    vi.doUnmock("next/headers");
  });

  async function makeTenantWithServiceAccountKey() {
    const ctx: TenantContext = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const roleIds = await seedSystemRoles(ctx);
    // "Backend System Owner" (index 1, the same fixture role @nextbot/iam's own test
    // suite uses): connectors Write, agent_platform Read — real Read but NOT Write on
    // agent_platform, exactly the asymmetry this test needs.
    const backendOwnerRoleId = roleIds[1]!;
    const serviceAccountUserId = await createServiceAccount(ctx, { name: "Public API CI Bot", roleIds: [backendOwnerRoleId] });
    const tenant = await resolveTenantById(ctx.tenantId);
    const { key } = await issueApiKey(ctx, tenant!.slug, serviceAccountUserId, { name: "public-api-test-key" });
    return { ctx, key };
  }

  function mockBearerHeader(key: string) {
    // Each test needs a FRESH module graph — `vi.doMock` alone would not retroactively
    // change what an already-cached `./session.js`/`./api-guard.js` import closed over
    // from a PRIOR test's mock, since ES module imports are cached per specifier.
    vi.resetModules();
    vi.doMock("next/headers", () => ({
      headers: async () => new Headers({ authorization: `Bearer ${key}` }),
      cookies: async () => ({ get: () => undefined }),
    }));
  }

  it("a real bearer key with agent_platform:Read grants access to a Read-gated public API route", async () => {
    const { key } = await makeTenantWithServiceAccountKey();
    mockBearerHeader(key);
    const { requirePublicApi } = await import("./api-guard.js");

    const guard = await requirePublicApi("agent_platform", "Read");
    expect(guard).not.toBeInstanceOf(Response);
  });

  it("SECURITY-CRITICAL: the SAME real bearer key is REJECTED with 403 by a Write-gated public API route — the identical gate a console session would hit", async () => {
    const { key } = await makeTenantWithServiceAccountKey();
    mockBearerHeader(key);
    const { requirePublicApi } = await import("./api-guard.js");

    const guard = await requirePublicApi("agent_platform", "Write");
    expect(guard).toBeInstanceOf(Response);
    expect((guard as Response).status).toBe(403);
  });

  it("a real POST to the actual /api/v1/external/agent-platform/definitions route returns 403 for the same under-scoped key", async () => {
    const { key } = await makeTenantWithServiceAccountKey();
    mockBearerHeader(key);
    const { NextRequest } = await import("next/server");
    const { POST } = await import("../../app/api/v1/external/agent-platform/definitions/route.js");

    const request = new NextRequest("http://localhost/api/v1/external/agent-platform/definitions", {
      method: "POST",
      body: JSON.stringify({ name: "should-not-be-created" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(request);
    expect(res.status).toBe(403);
  });

  it("a real GET to the actual /api/v1/external/agent-platform/definitions route succeeds (Read is granted) and reuses the SAME handler the console route calls", async () => {
    const { key } = await makeTenantWithServiceAccountKey();
    mockBearerHeader(key);
    const { GET } = await import("../../app/api/v1/external/agent-platform/definitions/route.js");

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { definitions: unknown[] };
    expect(body.definitions).toEqual([]);
  });

  it("an invalid/garbage bearer key is rejected with 401, never treated as an authenticated caller of any scope", async () => {
    mockBearerHeader("nbk_not-a-real-tenant.abc.def");
    const { requirePublicApi } = await import("./api-guard.js");

    const guard = await requirePublicApi("agent_platform", "Read");
    expect(guard).toBeInstanceOf(Response);
    expect((guard as Response).status).toBe(401);
  });
});
