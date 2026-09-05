import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { withPlatform, type PlatformClient } from "@nextbot/db/platform-only";
import { BreakglassAccessDeniedError } from "@nextbot/contracts";
import { resolveTenantById } from "./resolve-tenant.js";
import { getActiveBreakglassGrant, getMostRecentBreakglassGrant } from "./breakglass-grant.js";
import { classifyInactiveBreakglassGrant } from "../domain/breakglass-grant-policy.js";

/**
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — the platform-ops side of
 * Consented Break-Glass Operator Access. This is the ONLY new code in this phase that
 * constructs a `TenantContext` from a bare `tenantId` on an operator's behalf (mirroring
 * `resolveTenantById`'s own established "look up region, then act" shape) — it lives in
 * `packages/modules/tenancy` because that is one of the two allowed `withPlatform()`
 * callers (LLD §3.2 rule 4; dependency-cruiser's `no-platform-outside-allowed-callers`),
 * and both halves of the doubly-audited write (`platform_audit_log_entry` via
 * `withPlatform`, the tenant's own `domain_event` via `withTenant`) need to happen from
 * one place that can reach both primitives.
 *
 * **Fail-closed is the whole point of this file**: `requireActiveBreakglassTenantContext`
 * and `activateBreakglassAccess` both deny access — throwing `BreakglassAccessDeniedError`
 * — whenever `getActiveBreakglassGrant` (the tenant's own, RLS-protected read) returns
 * `null`, regardless of how validly authenticated the operator calling in is. The
 * platform-ops route guard (`requirePlatformApi()`) and this grant check are two
 * independent gates — passing the first (a genuinely valid operator token/IP) never
 * substitutes for the second.
 */

/** Builds the `TenantContext` this module uses to read/act on a tenant's own
 * RLS-protected tables, from nothing but a bare tenant id — the same "resolve region,
 * then act" shape `apps/web/src/lib/session.ts`'s `getSessionTenantContext` uses for a
 * logged-in tenant user, here with no session at all (the operator has none). Fixed
 * `environment: "Sandbox"` matches every other Admin-Console-adjacent composition
 * root's own established convention (`getSessionTenantContext`,
 * `listActiveTenantContexts`) — this is not a live conversation/tool-call runtime
 * context, it is an administrative read/audit path. */
async function resolveOperatorTenantContext(tenantId: string): Promise<TenantContext | null> {
  const tenant = await resolveTenantById(tenantId);
  if (!tenant) return null;
  return { tenantId: tenant.id, region: tenant.region, environment: "Sandbox" };
}

/** Writes one `platform_audit_log_entry` row for a denied activation attempt —
 * operator-side accountability only; nothing is written to the tenant's own trail
 * since nothing happened to their data (see this phase's plan doc, disclosed design
 * decision #6). */
async function auditDeniedAttempt(tenantId: string, actorLabel: string, reason: "no_grant" | "revoked" | "expired", operatorReason: string): Promise<void> {
  await withPlatform(async (db: PlatformClient) => {
    await db.insert(schema.platformAuditLogEntry).values({
      id: generateId(),
      actorLabel,
      actionType: "breakglass.access_denied",
      targetTenantId: tenantId,
      details: { reason, operatorReason },
    });
  });
}

/**
 * Read-only path gate: every break-glass diagnosis-read route
 * (`apps/web/app/api/internal/ops/tenants/:id/breakglass/{conversations,escalations}/**`)
 * calls this before serving any tenant data. Deliberately does NOT write any audit
 * entry itself (per this phase's disclosed "lifecycle events only" audit-granularity
 * decision) — the one auditable fact is `activateBreakglassAccess`'s own lifecycle
 * event; this function exists purely so a mid-session revocation takes effect on the
 * very next read, not just at the moment access was first activated.
 *
 * @returns `null` if `tenantId` doesn't resolve to a real tenant (caller renders 404).
 * @throws {BreakglassAccessDeniedError} if the tenant exists but has no currently
 *   active (unrevoked, unexpired) consent grant.
 */
export async function requireActiveBreakglassTenantContext(tenantId: string): Promise<{ ctx: TenantContext; grantId: string } | null> {
  const ctx = await resolveOperatorTenantContext(tenantId);
  if (!ctx) return null;

  const grant = await getActiveBreakglassGrant(ctx);
  if (!grant) {
    const mostRecent = await getMostRecentBreakglassGrant(ctx);
    const reason = classifyInactiveBreakglassGrant(mostRecent ? { expiresAt: mostRecent.expiresAt, revokedAt: mostRecent.revokedAt } : null);
    throw new BreakglassAccessDeniedError(reason);
  }
  return { ctx, grantId: grant.id };
}

/**
 * Activates a break-glass diagnosis session for one operator `POST .../activate` call
 * — the single auditable lifecycle event (doubly-audited on success): one
 * `domain_event` (`breakglass.access_activated`) via the tenant's own `withTenant`
 * path (mirrored into `audit_log_entry` by `@nextbot/audit`'s existing, unmodified sync
 * job — the tenant sees this in their own Audit Log), and one `platform_audit_log_entry`
 * row via `withPlatform` (the operator's own trail). These are two different Postgres
 * roles/connections and are not atomically joined — see this phase's plan doc,
 * disclosed design decision #4.
 *
 * @returns `null` if `tenantId` doesn't resolve to a real tenant (caller renders 404).
 * @throws {BreakglassAccessDeniedError} — fail-closed, regardless of the operator's own
 *   role/token validity — if no active consent grant exists for this tenant. Also
 *   writes one `platform_audit_log_entry` denial row for operator-side accountability
 *   (never a tenant-side entry — see disclosed design decision #6).
 */
export async function activateBreakglassAccess(tenantId: string, actorLabel: string, reason: string): Promise<{ grantId: string; expiresAt: Date } | null> {
  const ctx = await resolveOperatorTenantContext(tenantId);
  if (!ctx) return null;

  const grant = await getActiveBreakglassGrant(ctx);
  if (!grant) {
    const mostRecent = await getMostRecentBreakglassGrant(ctx);
    const denialReason = classifyInactiveBreakglassGrant(mostRecent ? { expiresAt: mostRecent.expiresAt, revokedAt: mostRecent.revokedAt } : null);
    await auditDeniedAttempt(tenantId, actorLabel, denialReason, reason);
    throw new BreakglassAccessDeniedError(denialReason);
  }

  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.domainEvent).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      type: "breakglass.access_activated",
      // `actorLabel` here is the OPERATOR's attribution (PLATFORM_OPERATOR_ACTOR_LABEL),
      // not a tenant user — `sync-audit-from-events.ts`'s `toAuditEntry` reads
      // `payload.actorLabel` verbatim, so the tenant's own Audit Log row correctly shows
      // "platform-operator" as the actor, not "system".
      payload: { grantId: grant.id, actorLabel, reason },
    });
  });

  await withPlatform(async (db: PlatformClient) => {
    await db.insert(schema.platformAuditLogEntry).values({
      id: generateId(),
      actorLabel,
      actionType: "breakglass.access_activated",
      targetTenantId: tenantId,
      details: { grantId: grant.id, reason },
    });
  });

  return { grantId: grant.id, expiresAt: grant.expiresAt };
}
