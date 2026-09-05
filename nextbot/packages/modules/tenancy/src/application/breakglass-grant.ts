import { and, desc, eq, isNull } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { BreakglassGrantAlreadyActiveError } from "@nextbot/contracts";
import { computeBreakglassGrantExpiry, isBreakglassGrantActive } from "../domain/breakglass-grant-policy.js";

/**
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — the tenant-side half of
 * Consented Break-Glass Operator Access: a tenant admin's explicit, time-boxed,
 * revocable consent grant. Everything here runs through `withTenant` (the tenant's own
 * RLS-protected path) — this file is called both by the tenant's own Settings screen
 * (`apps/web/app/api/v1/admin/settings/breakglass-grant/**`, with the session's own
 * `TenantContext`) and by `breakglass-access.ts` (with a `TenantContext` this module
 * constructs from a bare tenant id on the operator's behalf) to check grant validity.
 */
export interface BreakglassGrantRecord {
  id: string;
  tenantId: string;
  grantedByUserId: string;
  reason: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedByUserId: string | null;
}

function toRecord(row: typeof schema.tenantBreakglassGrant.$inferSelect): BreakglassGrantRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    grantedByUserId: row.grantedByUserId,
    reason: row.reason,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokedByUserId: row.revokedByUserId,
  };
}

/**
 * Returns the tenant's currently ACTIVE grant (unrevoked, unexpired), or `null` if
 * none exists. This is the single fail-closed read both the tenant's own settings
 * screen and every platform-ops access attempt (`breakglass-access.ts`) use to decide
 * "is there consent right now" — there is deliberately no caching of this result: a
 * revocation must take effect on the very next check, not once some cached value
 * expires.
 */
export async function getActiveBreakglassGrant(ctx: TenantContext): Promise<BreakglassGrantRecord | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.tenantBreakglassGrant)
      .where(and(eq(schema.tenantBreakglassGrant.tenantId, ctx.tenantId), isNull(schema.tenantBreakglassGrant.revokedAt)))
      .orderBy(desc(schema.tenantBreakglassGrant.createdAt));
    const now = new Date();
    const active = rows.find((r) => isBreakglassGrantActive({ expiresAt: r.expiresAt, revokedAt: r.revokedAt }, now));
    return active ? toRecord(active) : null;
  });
}

/** The single most recent grant this tenant has ever created, regardless of its
 * status (active, revoked, or expired) — or `null` if none exists at all. Used only to
 * enrich the platform audit trail's denial detail
 * (`classifyInactiveBreakglassGrant`), never to decide access itself (that decision is
 * always `getActiveBreakglassGrant`'s alone). */
export async function getMostRecentBreakglassGrant(ctx: TenantContext): Promise<BreakglassGrantRecord | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [row] = await db
      .select()
      .from(schema.tenantBreakglassGrant)
      .where(eq(schema.tenantBreakglassGrant.tenantId, ctx.tenantId))
      .orderBy(desc(schema.tenantBreakglassGrant.createdAt))
      .limit(1);
    return row ? toRecord(row) : null;
  });
}

/** Every grant this tenant has ever created (active, revoked, or expired) — newest
 * first — for the Settings screen's history list. */
export async function listBreakglassGrants(ctx: TenantContext): Promise<BreakglassGrantRecord[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.tenantBreakglassGrant)
      .where(eq(schema.tenantBreakglassGrant.tenantId, ctx.tenantId))
      .orderBy(desc(schema.tenantBreakglassGrant.createdAt));
    return rows.map(toRecord);
  });
}

export interface CreateBreakglassGrantInput {
  grantedByUserId: string;
  reason: string;
  expiresInHours: number;
}

/**
 * Creates a new break-glass consent grant. Rejects outright
 * (`BreakglassGrantAlreadyActiveError`, 409) if this tenant already has an active
 * grant — "the active grant" must always be unambiguous, both for this screen and for
 * the platform-ops fail-closed check, so a tenant must explicitly revoke before
 * creating a replacement. `computeBreakglassGrantExpiry` enforces the platform-wide
 * time-box cap (`BreakglassGrantExpiryTooLongError`) before any row is written.
 *
 * Writes one `domain_event` (`breakglass.grant_created`) in the same `withTenant`
 * transaction as the insert — mirrors every other tenant-scoped module's own outbox
 * convention (LLD §2.4); `@nextbot/audit`'s existing, unmodified sync job mirrors this
 * into the tenant's own `audit_log_entry` so the Audit Log screen shows exactly when
 * and why this tenant consented to break-glass access.
 *
 * @throws {BreakglassGrantAlreadyActiveError} if an active grant already exists.
 * @throws {BreakglassGrantExpiryTooLongError} if `expiresInHours` exceeds the cap.
 */
export async function createBreakglassGrant(ctx: TenantContext, input: CreateBreakglassGrantInput): Promise<BreakglassGrantRecord> {
  const expiresAt = computeBreakglassGrantExpiry(input.expiresInHours);

  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db
      .select()
      .from(schema.tenantBreakglassGrant)
      .where(and(eq(schema.tenantBreakglassGrant.tenantId, ctx.tenantId), isNull(schema.tenantBreakglassGrant.revokedAt)))
      .orderBy(desc(schema.tenantBreakglassGrant.createdAt));
    const now = new Date();
    if (existing.some((r) => isBreakglassGrantActive({ expiresAt: r.expiresAt, revokedAt: r.revokedAt }, now))) {
      throw new BreakglassGrantAlreadyActiveError();
    }

    const id = generateId();
    const [inserted] = await db
      .insert(schema.tenantBreakglassGrant)
      .values({
        id,
        tenantId: ctx.tenantId,
        grantedByUserId: input.grantedByUserId,
        reason: input.reason,
        expiresAt,
      })
      .returning();

    await db.insert(schema.domainEvent).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      type: "breakglass.grant_created",
      // No PII in the payload: only identifiers, the actor, and the time-box —
      // `reason` is the tenant's own free-text scope description, which the tenant is
      // already the author of (never customer data), so it is safe to mirror verbatim
      // into their own audit trail.
      payload: { grantId: id, grantedByUserId: input.grantedByUserId, reason: input.reason, expiresAt: expiresAt.toISOString() },
    });

    return toRecord(inserted!);
  });
}

/**
 * Revokes an active grant early. Idempotent-safe: revoking an already-revoked grant
 * is a no-op that still returns the (unchanged) row, never an error — a tenant admin
 * clicking "revoke" twice (e.g. a slow network retry) must never surface a confusing
 * failure. Returns `null` if `grantId` doesn't resolve within this tenant (RLS already
 * guarantees a cross-tenant id can never match here).
 */
export async function revokeBreakglassGrant(ctx: TenantContext, grantId: string, revokedByUserId: string): Promise<BreakglassGrantRecord | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [existing] = await db
      .select()
      .from(schema.tenantBreakglassGrant)
      .where(and(eq(schema.tenantBreakglassGrant.id, grantId), eq(schema.tenantBreakglassGrant.tenantId, ctx.tenantId)));
    if (!existing) return null;
    if (existing.revokedAt !== null) return toRecord(existing);

    const [updated] = await db
      .update(schema.tenantBreakglassGrant)
      .set({ revokedAt: new Date(), revokedByUserId })
      .where(eq(schema.tenantBreakglassGrant.id, grantId))
      .returning();

    await db.insert(schema.domainEvent).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      type: "breakglass.grant_revoked",
      payload: { grantId, revokedByUserId },
    });

    return toRecord(updated!);
  });
}
