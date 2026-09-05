import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, withTenant, getOwnerPool, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { withPlatform } from "@nextbot/db/platform-only";
import { BreakglassAccessDeniedError } from "@nextbot/contracts";
import { activateBreakglassAccess, requireActiveBreakglassTenantContext } from "./breakglass-access.js";
import { createBreakglassGrant, revokeBreakglassGrant } from "./breakglass-grant.js";

/**
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — the platform-ops
 * fail-closed gate, exercised against a real database (no mocked guard, no mocked
 * grant lookup): a genuinely valid activation call is denied whenever no active
 * consent grant exists, regardless of the caller's own role/token validity (verified
 * separately, end to end through the real HTTP route + real `requirePlatformApi()`, in
 * `apps/web/app/api/internal/ops/tenants/[id]/breakglass/breakglass-ops.int.test.ts` —
 * this file proves the same property at the application layer this phase's own
 * dispatch brief names as the hard requirement, with the same rigor as every other
 * auth-boundary property this project has verified).
 */
const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) {
    // `platform_audit_log_entry` is genuinely append-only for both the "app" and
    // "platform" roles (`ensure-roles.ts` REVOKEs UPDATE/DELETE from both) — only the
    // schema-owner role retains DELETE, same test-hygiene exception
    // `provision-tenant-audit.int.test.ts` already established for this table.
    await getOwnerPool().query(`DELETE FROM platform_audit_log_entry WHERE target_tenant_id = $1`, [id]);
    await deleteFixtureTenant(id);
  }
});

const OPERATOR_ACTOR_LABEL = "platform-operator";

async function domainEventsOfType(ctx: TenantContext, type: string) {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.domainEvent).where(and(eq(schema.domainEvent.tenantId, ctx.tenantId), eq(schema.domainEvent.type, type))),
  );
}

async function platformAuditEntriesOfType(tenantId: string, actionType: string) {
  return withPlatform((db) =>
    db.select().from(schema.platformAuditLogEntry).where(and(eq(schema.platformAuditLogEntry.targetTenantId, tenantId), eq(schema.platformAuditLogEntry.actionType, actionType))),
  );
}

async function forceExpire(ctx: TenantContext, grantId: string) {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.tenantBreakglassGrant).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.tenantBreakglassGrant.id, grantId)),
  );
}

describe("activateBreakglassAccess — fail-closed with no consent grant (Phase 20, FR-ADM-09's named hard requirement)", () => {
  it("denies a request when no grant has ever been created for this tenant, and audits the denial platform-side only", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const attempt = activateBreakglassAccess(ctx.tenantId, OPERATOR_ACTOR_LABEL, "checking a customer complaint");
    await expect(attempt).rejects.toBeInstanceOf(BreakglassAccessDeniedError);
    await expect(attempt.catch((err) => err)).resolves.toMatchObject({ reason: "no_grant" });

    const denials = await platformAuditEntriesOfType(ctx.tenantId, "breakglass.access_denied");
    expect(denials).toHaveLength(1);
    expect(denials[0]!.actorLabel).toBe(OPERATOR_ACTOR_LABEL);
    expect(denials[0]!.details).toMatchObject({ reason: "no_grant" });
    // Nothing on the tenant's own trail — no data was accessed, nothing to tell them.
    expect(await domainEventsOfType(ctx, "breakglass.access_activated")).toHaveLength(0);
  });

  it("denies a request once the tenant has explicitly revoked its grant", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const grant = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });
    await revokeBreakglassGrant(ctx, grant.id, crypto.randomUUID());

    await expect(activateBreakglassAccess(ctx.tenantId, OPERATOR_ACTOR_LABEL, "diagnosis")).rejects.toMatchObject({ reason: "revoked" });
    const denials = await platformAuditEntriesOfType(ctx.tenantId, "breakglass.access_denied");
    expect(denials[0]?.details).toMatchObject({ reason: "revoked" });
  });

  it("denies a request once the grant's time-box has elapsed, even though never revoked", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const grant = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });
    await forceExpire(ctx, grant.id);

    await expect(activateBreakglassAccess(ctx.tenantId, OPERATOR_ACTOR_LABEL, "diagnosis")).rejects.toMatchObject({ reason: "expired" });
    const denials = await platformAuditEntriesOfType(ctx.tenantId, "breakglass.access_denied");
    expect(denials[0]?.details).toMatchObject({ reason: "expired" });
  });

  it("returns null (not a thrown error) for a tenant id that doesn't resolve to a real tenant", async () => {
    expect(await activateBreakglassAccess(crypto.randomUUID(), OPERATOR_ACTOR_LABEL, "diagnosis")).toBeNull();
  });
});

describe("activateBreakglassAccess — doubly-audited on success (Phase 20, FR-ADM-09)", () => {
  it("writes a real row on BOTH audit trails, correctly attributed, when an active grant exists", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const grant = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "tenant's own consent reason", expiresInHours: 2 });

    const result = await activateBreakglassAccess(ctx.tenantId, OPERATOR_ACTOR_LABEL, "diagnosing a reported outage");
    expect(result).toEqual({ grantId: grant.id, expiresAt: grant.expiresAt });

    // Tenant's own trail (mirrored into audit_log_entry by @nextbot/audit's existing,
    // unmodified sync job — proven here at the domain_event layer, matching this
    // codebase's own established convention for this class of proof).
    const tenantEvents = await domainEventsOfType(ctx, "breakglass.access_activated");
    expect(tenantEvents).toHaveLength(1);
    expect(tenantEvents[0]!.payload).toMatchObject({ grantId: grant.id, actorLabel: OPERATOR_ACTOR_LABEL, reason: "diagnosing a reported outage" });

    // Operator's own trail.
    const platformEntries = await platformAuditEntriesOfType(ctx.tenantId, "breakglass.access_activated");
    expect(platformEntries).toHaveLength(1);
    expect(platformEntries[0]!.actorLabel).toBe(OPERATOR_ACTOR_LABEL);
    expect(platformEntries[0]!.details).toMatchObject({ grantId: grant.id, reason: "diagnosing a reported outage" });
  });
});

describe("requireActiveBreakglassTenantContext (Phase 20, FR-ADM-09 — the per-read gate)", () => {
  it("returns the tenant context + grant id when a grant is active, writing NO audit entry of its own (lifecycle-events-only design)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const grant = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });

    const result = await requireActiveBreakglassTenantContext(ctx.tenantId);
    expect(result?.grantId).toBe(grant.id);
    expect(result?.ctx.tenantId).toBe(ctx.tenantId);

    expect(await domainEventsOfType(ctx, "breakglass.access_activated")).toHaveLength(0);
    expect(await platformAuditEntriesOfType(ctx.tenantId, "breakglass.access_activated")).toHaveLength(0);
  });

  it("throws BreakglassAccessDeniedError with no active grant", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await expect(requireActiveBreakglassTenantContext(ctx.tenantId)).rejects.toMatchObject({ reason: "no_grant" });
  });

  it("returns null for an unknown tenant id", async () => {
    expect(await requireActiveBreakglassTenantContext(crypto.randomUUID())).toBeNull();
  });

  it("a mid-session revocation takes effect on the very next read — no caching of a prior successful activation", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const grant = await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "r", expiresInHours: 1 });

    await activateBreakglassAccess(ctx.tenantId, OPERATOR_ACTOR_LABEL, "diagnosis");
    expect((await requireActiveBreakglassTenantContext(ctx.tenantId))?.grantId).toBe(grant.id);

    await revokeBreakglassGrant(ctx, grant.id, crypto.randomUUID());
    await expect(requireActiveBreakglassTenantContext(ctx.tenantId)).rejects.toMatchObject({ reason: "revoked" });
  });
});
