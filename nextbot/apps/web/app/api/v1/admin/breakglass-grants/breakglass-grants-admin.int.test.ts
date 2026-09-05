import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { generateId } from "@nextbot/db";

const testUserId = generateId();

vi.mock("server-only", () => ({}));

let ctx: TenantContext;
afterEach(async () => {
  if (ctx) await deleteFixtureTenant(ctx.tenantId);
  vi.doUnmock("@/src/lib/session");
  vi.resetModules();
});

async function mockSessionAs(level: "Read" | "Write" | "None") {
  vi.doMock("@/src/lib/session", () => ({
    getSession: async () =>
      level === "None"
        ? { permissions: {}, tenantId: ctx.tenantId, userId: testUserId, roleIds: [] }
        : { permissions: { security_settings: level }, tenantId: ctx.tenantId, userId: testUserId, roleIds: ["role-1"] },
    getSessionTenantContext: async () => ctx,
  }));
}

/**
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — Consented Break-Glass
 * Operator Access, tenant-side settings API. Real Postgres, real RBAC guard, only the
 * session/auth seam mocked (this codebase's own established convention for admin-route
 * integration tests — see `dsr-admin.int.test.ts`).
 */
describe("Break-glass grants admin API (Phase 20, real Postgres)", () => {
  it("GET /breakglass-grants 403s without security_settings=Read", async () => {
    ctx = await createFixtureTenant();
    await mockSessionAs("None");
    const { GET } = await import("./route.js");
    expect((await GET()).status).toBe(403);
  });

  it("POST /breakglass-grants 403s without security_settings=Write", async () => {
    ctx = await createFixtureTenant();
    await mockSessionAs("Read");
    const { POST } = await import("./route.js");
    const res = await POST(new NextRequest("http://localhost/api/v1/admin/breakglass-grants", { method: "POST", body: JSON.stringify({ reason: "r", expiresInHours: 1 }) }));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid body (missing reason) with 422", async () => {
    ctx = await createFixtureTenant();
    await mockSessionAs("Write");
    const { POST } = await import("./route.js");
    const res = await POST(new NextRequest("http://localhost/api/v1/admin/breakglass-grants", { method: "POST", body: JSON.stringify({ expiresInHours: 1 }) }));
    expect(res.status).toBe(422);
  });

  it("rejects an expiresInHours beyond the platform maximum with 422", async () => {
    ctx = await createFixtureTenant();
    await mockSessionAs("Write");
    const { POST } = await import("./route.js");
    const res = await POST(
      new NextRequest("http://localhost/api/v1/admin/breakglass-grants", { method: "POST", body: JSON.stringify({ reason: "r", expiresInHours: 999 }) }),
    );
    expect(res.status).toBe(422);
  });

  it("creates a grant, lists it, and rejects creating a second one while it's active (409)", async () => {
    ctx = await createFixtureTenant();
    await mockSessionAs("Write");
    const { GET, POST } = await import("./route.js");

    const createRes = await POST(
      new NextRequest("http://localhost/api/v1/admin/breakglass-grants", { method: "POST", body: JSON.stringify({ reason: "investigating an outage", expiresInHours: 4 }) }),
    );
    expect(createRes.status).toBe(201);
    const { grant } = await createRes.json();
    expect(grant.grantedByUserId).toBe(testUserId);

    const listRes = await GET();
    const { grants } = await listRes.json();
    expect(grants).toHaveLength(1);
    expect(grants[0].id).toBe(grant.id);

    const secondRes = await POST(
      new NextRequest("http://localhost/api/v1/admin/breakglass-grants", { method: "POST", body: JSON.stringify({ reason: "second", expiresInHours: 1 }) }),
    );
    expect(secondRes.status).toBe(409);
  });

  it("revokes a grant via POST /breakglass-grants/:id/revoke, and revoking again is a no-op (200, not an error)", async () => {
    ctx = await createFixtureTenant();
    await mockSessionAs("Write");
    const { POST } = await import("./route.js");
    const createRes = await POST(
      new NextRequest("http://localhost/api/v1/admin/breakglass-grants", { method: "POST", body: JSON.stringify({ reason: "r", expiresInHours: 1 }) }),
    );
    const { grant } = await createRes.json();

    const { POST: revoke } = await import("./[id]/revoke/route.js");
    const revokeRes = await revoke(new NextRequest(`http://localhost/api/v1/admin/breakglass-grants/${grant.id}/revoke`, { method: "POST" }), {
      params: Promise.resolve({ id: grant.id }),
    });
    expect(revokeRes.status).toBe(200);
    const { grant: revoked } = await revokeRes.json();
    expect(revoked.revokedAt).not.toBeNull();

    const secondRevokeRes = await revoke(new NextRequest(`http://localhost/api/v1/admin/breakglass-grants/${grant.id}/revoke`, { method: "POST" }), {
      params: Promise.resolve({ id: grant.id }),
    });
    expect(secondRevokeRes.status).toBe(200);
  });

  it("returns 404 revoking a nonexistent grant id", async () => {
    ctx = await createFixtureTenant();
    await mockSessionAs("Write");
    const { POST: revoke } = await import("./[id]/revoke/route.js");
    const res = await revoke(new NextRequest("http://localhost/api/v1/admin/breakglass-grants/does-not-exist/revoke", { method: "POST" }), {
      params: Promise.resolve({ id: generateId() }),
    });
    expect(res.status).toBe(404);
  });
});
