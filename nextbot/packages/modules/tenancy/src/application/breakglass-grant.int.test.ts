import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { BreakglassGrantAlreadyActiveError, BreakglassGrantExpiryTooLongError } from "@nextbot/contracts";
import { createBreakglassGrant, getActiveBreakglassGrant, getMostRecentBreakglassGrant, listBreakglassGrants, revokeBreakglassGrant } from "./breakglass-grant.js";

/**
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — the tenant-side consent
 * grant's real-DB behavior: creation/time-box validation/one-active-grant-at-a-time,
 * revocation (idempotent), and the `domain_event` this module writes on both
 * lifecycle transitions (the tenant-side half of "doubly-audited" — mirrored into
 * `audit_log_entry` by `@nextbot/audit`'s existing, unmodified outbox sync job, tested
 * independently in its own suite; this file proves only that THIS module writes the
 * correct row, matching the established convention
 * `escalation-repository-domain-event.int.test.ts` already uses for the same class of
 * proof).
 */
const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function domainEventsOfType(ctx: TenantContext, type: string) {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.domainEvent).where(and(eq(schema.domainEvent.tenantId, ctx.tenantId), eq(schema.domainEvent.type, type))),
  );
}

/** Directly rewrites a grant's `expires_at` to simulate an already-expired grant
 * without waiting real time — the same technique this codebase's other expiry tests
 * (Tier-3 approvals, workflow suspensions) already use. */
async function forceExpire(ctx: TenantContext, grantId: string) {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.tenantBreakglassGrant).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.tenantBreakglassGrant.id, grantId)),
  );
}

describe("createBreakglassGrant (Phase 20, FR-ADM-09)", () => {
  it("creates a grant with the requested time-box and writes one breakglass.grant_created domain_event", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const userId = crypto.randomUUID();

    const grant = await createBreakglassGrant(ctx, { grantedByUserId: userId, reason: "Investigating a customer-reported outage.", expiresInHours: 4 });
    expect(grant.tenantId).toBe(ctx.tenantId);
    expect(grant.grantedByUserId).toBe(userId);
    expect(grant.revokedAt).toBeNull();
    expect(grant.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const events = await domainEventsOfType(ctx, "breakglass.grant_created");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ grantId: grant.id, grantedByUserId: userId, reason: "Investigating a customer-reported outage." });
  });

  it("rejects a window longer than the platform maximum (24h) and writes no row", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    await expect(
      createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "too long", expiresInHours: 25 }),
    ).rejects.toThrow(BreakglassGrantExpiryTooLongError);

    expect(await listBreakglassGrants(ctx)).toHaveLength(0);
  });

  it("rejects creating a second grant while one is already active (must revoke first)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "first", expiresInHours: 1 });

    await expect(
      createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "second", expiresInHours: 1 }),
    ).rejects.toThrow(BreakglassGrantAlreadyActiveError);
    expect(await listBreakglassGrants(ctx)).toHaveLength(1);
  });

  it("allows creating a new grant once the previous one is revoked", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const first = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "first", expiresInHours: 1 });
    await revokeBreakglassGrant(ctx, first.id, crypto.randomUUID());

    const second = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "second", expiresInHours: 1 });
    expect(second.id).not.toBe(first.id);
    expect(await listBreakglassGrants(ctx)).toHaveLength(2);
  });

  it("allows creating a new grant once the previous one has expired (not just revoked)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const first = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "first", expiresInHours: 1 });
    await forceExpire(ctx, first.id);

    const second = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "second", expiresInHours: 1 });
    expect(second.id).not.toBe(first.id);
  });
});

describe("getActiveBreakglassGrant (Phase 20, FR-ADM-09)", () => {
  it("returns null when no grant has ever been created", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    expect(await getActiveBreakglassGrant(ctx)).toBeNull();
  });

  it("returns the grant while unexpired and unrevoked", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const grant = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });
    expect((await getActiveBreakglassGrant(ctx))?.id).toBe(grant.id);
  });

  it("returns null once revoked", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const grant = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });
    await revokeBreakglassGrant(ctx, grant.id, crypto.randomUUID());
    expect(await getActiveBreakglassGrant(ctx)).toBeNull();
  });

  it("returns null once past its expiry, even though never revoked", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const grant = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });
    await forceExpire(ctx, grant.id);
    expect(await getActiveBreakglassGrant(ctx)).toBeNull();
    // But it is still visible to the "most recent" read used for audit-denial detail.
    expect((await getMostRecentBreakglassGrant(ctx))?.id).toBe(grant.id);
  });

  it("never returns another tenant's grant (RLS)", async () => {
    const ctxA = await createFixtureTenant();
    const ctxB = await createFixtureTenant();
    createdTenantIds.push(ctxA.tenantId, ctxB.tenantId);
    await createBreakglassGrant(ctxA, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });
    expect(await getActiveBreakglassGrant(ctxB)).toBeNull();
  });
});

describe("revokeBreakglassGrant (Phase 20, FR-ADM-09)", () => {
  it("revokes an active grant and writes one breakglass.grant_revoked domain_event", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const grant = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });
    const revokerId = crypto.randomUUID();

    const revoked = await revokeBreakglassGrant(ctx, grant.id, revokerId);
    expect(revoked?.revokedAt).not.toBeNull();
    expect(revoked?.revokedByUserId).toBe(revokerId);

    const events = await domainEventsOfType(ctx, "breakglass.grant_revoked");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ grantId: grant.id, revokedByUserId: revokerId });
  });

  it("is idempotent — revoking an already-revoked grant is a no-op, not an error, and writes no second event", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const grant = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });
    const revokerId = crypto.randomUUID();
    await revokeBreakglassGrant(ctx, grant.id, revokerId);
    const secondAttempt = await revokeBreakglassGrant(ctx, grant.id, crypto.randomUUID());

    expect(secondAttempt?.revokedByUserId).toBe(revokerId); // unchanged from the first, real revocation
    expect(await domainEventsOfType(ctx, "breakglass.grant_revoked")).toHaveLength(1);
  });

  it("returns null for a nonexistent grant id", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    expect(await revokeBreakglassGrant(ctx, crypto.randomUUID(), crypto.randomUUID())).toBeNull();
  });

  it("never revokes another tenant's grant (RLS) — cross-tenant id resolves to null, original grant stays active", async () => {
    const ctxA = await createFixtureTenant();
    const ctxB = await createFixtureTenant();
    createdTenantIds.push(ctxA.tenantId, ctxB.tenantId);
    const grantA = await createBreakglassGrant(ctxA, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });

    expect(await revokeBreakglassGrant(ctxB, grantA.id, crypto.randomUUID())).toBeNull();
    expect((await getActiveBreakglassGrant(ctxA))?.id).toBe(grantA.id);
  });
});
