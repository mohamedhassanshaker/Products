import { and, desc, eq, isNull } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { SESSION_TTL_SECONDS } from "../domain/session-policy.js";

/**
 * `auth_session` (Phase 4, BL-36, FR-SEC-10) — the persisted counterpart to the
 * stateless session JWT, existing solely so a session can be revoked in real
 * time (see `packages/db/src/schema/iam.ts`'s doc comment and the module
 * README's decision log #5).
 */
export interface AuthSessionRow {
  id: string;
  userId: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Creates the DB-side session record for a freshly issued session JWT. The
 * returned id is embedded in the JWT as the `sid` claim. */
export async function insertAuthSession(
  ctx: TenantContext,
  input: { userId: string; ip?: string; userAgent?: string },
): Promise<string> {
  const id = generateId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.authSession).values({
      id,
      tenantId: ctx.tenantId,
      userId: input.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      expiresAt,
    });
  });
  return id;
}

/**
 * Returns `true` iff the session is still valid (not revoked, not past its
 * expiry) — the single check every session-consuming request performs so a
 * revocation takes effect on the very next request, never a cached/delayed one.
 * A session id that doesn't resolve at all (never issued in this tenant, or
 * belongs to a different tenant entirely) is treated identically to "revoked" —
 * fail closed, not "assume valid because we can't prove otherwise."
 */
export async function isSessionActive(ctx: TenantContext, sessionId: string): Promise<boolean> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ revokedAt: schema.authSession.revokedAt, expiresAt: schema.authSession.expiresAt })
      .from(schema.authSession)
      .where(and(eq(schema.authSession.tenantId, ctx.tenantId), eq(schema.authSession.id, sessionId)));
    const row = rows[0];
    if (!row) return false;
    if (row.revokedAt !== null) return false;
    if (row.expiresAt.getTime() <= Date.now()) return false;
    return true;
  });
}

/** Lists a single user's active (not revoked, not expired) sessions, most
 * recently seen first — the personal "active sessions" screen. */
export async function listActiveSessionsForUser(ctx: TenantContext, userId: string): Promise<AuthSessionRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.authSession)
      .where(
        and(
          eq(schema.authSession.tenantId, ctx.tenantId),
          eq(schema.authSession.userId, userId),
          isNull(schema.authSession.revokedAt),
        ),
      )
      .orderBy(desc(schema.authSession.lastSeenAt));
    return rows.filter((r) => r.expiresAt.getTime() > Date.now());
  });
}

/** Admin view: every active session across the tenant, joined with the owning
 * user's email/display name — "Session management" (admin-facing) screen. */
export async function listActiveSessionsForTenant(
  ctx: TenantContext,
): Promise<Array<AuthSessionRow & { userEmail: string; userDisplayName: string }>> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({
        id: schema.authSession.id,
        userId: schema.authSession.userId,
        ip: schema.authSession.ip,
        userAgent: schema.authSession.userAgent,
        createdAt: schema.authSession.createdAt,
        lastSeenAt: schema.authSession.lastSeenAt,
        expiresAt: schema.authSession.expiresAt,
        revokedAt: schema.authSession.revokedAt,
        userEmail: schema.appUser.email,
        userDisplayName: schema.appUser.displayName,
      })
      .from(schema.authSession)
      .innerJoin(schema.appUser, eq(schema.authSession.userId, schema.appUser.id))
      .where(and(eq(schema.authSession.tenantId, ctx.tenantId), isNull(schema.authSession.revokedAt)))
      .orderBy(desc(schema.authSession.lastSeenAt));
    return rows.filter((r) => r.expiresAt.getTime() > Date.now());
  });
}

/** Revokes one session by id. Idempotent — revoking an already-revoked/unknown
 * session is a no-op, never an error (a caller re-clicking "revoke" shouldn't see
 * a 404/500). Scoped by `(tenantId, id)` and, when `ownerUserId` is supplied, also
 * by `userId` — self-service revocation must never be able to revoke someone
 * else's session by guessing/enumerating an id. */
export async function revokeSession(ctx: TenantContext, sessionId: string, ownerUserId?: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    const conditions = [eq(schema.authSession.tenantId, ctx.tenantId), eq(schema.authSession.id, sessionId)];
    if (ownerUserId) conditions.push(eq(schema.authSession.userId, ownerUserId));
    await db.update(schema.authSession).set({ revokedAt: new Date() }).where(and(...conditions));
  });
}

/** Revokes every active session for a user — "sign out everywhere" / admin
 * deactivation cascade (also used by the SCIM deprovisioning path). */
export async function revokeAllSessionsForUser(ctx: TenantContext, userId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.authSession)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.authSession.tenantId, ctx.tenantId), eq(schema.authSession.userId, userId), isNull(schema.authSession.revokedAt)));
  });
}

/** Bumps `last_seen_at` — best-effort activity tracking, called opportunistically
 * (never awaited on the hot request path in a way that would delay the response;
 * see `apps/web/src/lib/session.ts`). */
export async function touchSession(ctx: TenantContext, sessionId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.authSession)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(schema.authSession.tenantId, ctx.tenantId), eq(schema.authSession.id, sessionId)));
  });
}
