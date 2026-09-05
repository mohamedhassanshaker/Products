import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, withTenant, getOwnerPool, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

// The one non-security-relevant seam mocked here, exactly like `platform-api-guard.test.ts`
// (this codebase's own established convention): `requirePlatformApi()` itself runs for
// REAL against real env vars/a genuinely valid operator token — only the Redis-backed
// rate limiter is stubbed out so this test doesn't depend on a reachable Redis instance.
const checkRateLimitMock = vi.fn();
vi.mock("@/src/lib/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimitMock(...a),
}));

const ORIGINAL_ENV = { ...process.env };
const createdTenantIds: string[] = [];

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  for (const id of createdTenantIds.splice(0)) {
    // `platform_audit_log_entry` is genuinely append-only — only the schema-owner
    // role retains DELETE (see `breakglass-access.int.test.ts`'s identical note).
    await getOwnerPool().query(`DELETE FROM platform_audit_log_entry WHERE target_tenant_id = $1`, [id]);
    await deleteFixtureTenant(id);
  }
});

function configureOps() {
  process.env.NEXTBOT_OPS_OPERATOR_TOKEN = "correct-token";
  process.env.NEXTBOT_OPS_IP_ALLOWLIST = "10.0.0.0/24";
  process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS = "203.0.113.1/32";
}
const ALLOWED_IP_HEADERS = { "x-forwarded-for": "10.0.0.42, 203.0.113.1" };

function activateRequest(tenantId: string, reason = "diagnosing a reported outage") {
  return new NextRequest(`http://localhost/api/internal/ops/tenants/${tenantId}/breakglass/activate`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer correct-token", ...ALLOWED_IP_HEADERS },
    body: JSON.stringify({ reason }),
  });
}

function conversationsRequest(tenantId: string) {
  return new NextRequest(`http://localhost/api/internal/ops/tenants/${tenantId}/breakglass/conversations`, {
    headers: { authorization: "Bearer correct-token", ...ALLOWED_IP_HEADERS },
  });
}

async function forceExpire(ctx: TenantContext, grantId: string) {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.tenantBreakglassGrant).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.tenantBreakglassGrant.id, grantId)),
  );
}

/**
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — the spec's own named
 * hard requirement, proven end to end: a genuinely valid platform-operator token,
 * hitting the real `/api/internal/ops/tenants/:id/breakglass/{activate,conversations}`
 * route handlers with a real database, is still rejected whenever no active tenant-side
 * consent grant exists — regardless of how validly authenticated the operator is.
 * `requirePlatformApi()` itself is NOT mocked here (only its own Redis rate-limit
 * dependency is), so this is a real exercise of the token/IP-allowlist gate, not a
 * simulation of it — the same rigor `platform-api-guard.test.ts` already applies to
 * every other denial reason on this surface.
 */
describe("Break-glass ops routes — fail-closed with no consent grant, real guard + real DB (Phase 20, FR-ADM-09)", () => {
  it("a genuinely valid operator token/IP is still denied 403 when the tenant has never created a grant", async () => {
    configureOps();
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 29, limit: 30 });
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const { POST } = await import("./activate/route.js");
    const res = await POST(activateRequest(ctx.tenantId), { params: Promise.resolve({ id: ctx.tenantId }) });
    expect(res.status).toBe(403);

    // And the read-only diagnosis surface denies the same valid operator identically.
    const { GET } = await import("./conversations/route.js");
    const readRes = await GET(conversationsRequest(ctx.tenantId), { params: Promise.resolve({ id: ctx.tenantId }) });
    expect(readRes.status).toBe(403);
  });

  it("is still denied once the tenant's grant has been explicitly revoked", async () => {
    configureOps();
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 29, limit: 30 });
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const { createBreakglassGrant, revokeBreakglassGrant } = await import("@nextbot/tenancy");
    const grant = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });
    await revokeBreakglassGrant(ctx, grant.id, crypto.randomUUID());

    const { POST } = await import("./activate/route.js");
    const res = await POST(activateRequest(ctx.tenantId), { params: Promise.resolve({ id: ctx.tenantId }) });
    expect(res.status).toBe(403);
  });

  it("is still denied once the tenant's grant has expired, even though never revoked", async () => {
    configureOps();
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 29, limit: 30 });
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const { createBreakglassGrant } = await import("@nextbot/tenancy");
    const grant = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });
    await forceExpire(ctx, grant.id);

    const { POST } = await import("./activate/route.js");
    const res = await POST(activateRequest(ctx.tenantId), { params: Promise.resolve({ id: ctx.tenantId }) });
    expect(res.status).toBe(403);
  });

  it("still denies a caller with an invalid token even when a valid grant exists (the two gates are independent)", async () => {
    configureOps();
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 29, limit: 30 });
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const { createBreakglassGrant } = await import("@nextbot/tenancy");
    await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });

    const { POST } = await import("./activate/route.js");
    const badTokenReq = new NextRequest(`http://localhost/api/internal/ops/tenants/${ctx.tenantId}/breakglass/activate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong-token", ...ALLOWED_IP_HEADERS },
      body: JSON.stringify({ reason: "diagnosis" }),
    });
    const res = await POST(badTokenReq, { params: Promise.resolve({ id: ctx.tenantId }) });
    // The unauthenticated-caller denial is the shared not-found shape (NFR-11), never
    // a 403 that would confirm the route exists — this proves a valid grant existing
    // does NOT let an invalid operator token through.
    expect(res.status).toBe(404);
  });

  it("succeeds end to end with BOTH a genuinely valid operator token and an active tenant grant", async () => {
    configureOps();
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 29, limit: 30 });
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const { createBreakglassGrant } = await import("@nextbot/tenancy");
    const grant = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });

    const { POST } = await import("./activate/route.js");
    const activateRes = await POST(activateRequest(ctx.tenantId), { params: Promise.resolve({ id: ctx.tenantId }) });
    expect(activateRes.status).toBe(200);
    const body = await activateRes.json();
    expect(body.grantId).toBe(grant.id);

    const { GET } = await import("./conversations/route.js");
    const readRes = await GET(conversationsRequest(ctx.tenantId), { params: Promise.resolve({ id: ctx.tenantId }) });
    expect(readRes.status).toBe(200);
  });
});
