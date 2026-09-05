import { BREAKGLASS_MAX_GRANT_HOURS } from "@nextbot/contracts";
import { BreakglassGrantExpiryTooLongError } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — pure domain rules for
 * the break-glass consent grant's time-box, with no I/O (LLD §2.2: domain logic
 * belongs here, DB-backed reads/writes are a separate `application/` concern).
 */

/**
 * Computes the grant's `expires_at` from a requested `expiresInHours` window,
 * rejecting outright (never clamping) a request that exceeds
 * `BREAKGLASS_MAX_GRANT_HOURS`. The contracts schema (`CreateBreakglassGrantRequestSchema`)
 * already bounds `expiresInHours` to `[1, BREAKGLASS_MAX_GRANT_HOURS]` at the HTTP
 * edge — this defensive re-check exists so any other future caller of the domain
 * layer (a script, a different composition root) cannot bypass the cap by skipping
 * the HTTP schema.
 *
 * @throws {BreakglassGrantExpiryTooLongError} if `expiresInHours` exceeds the cap.
 */
export function computeBreakglassGrantExpiry(expiresInHours: number, now: Date = new Date()): Date {
  if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > BREAKGLASS_MAX_GRANT_HOURS) {
    throw new BreakglassGrantExpiryTooLongError(BREAKGLASS_MAX_GRANT_HOURS);
  }
  return new Date(now.getTime() + expiresInHours * 60 * 60 * 1000);
}

/** A grant row's minimal shape this policy needs — kept structural (not importing the
 * Drizzle row type) so this stays a pure, DB-agnostic function. */
export interface BreakglassGrantTimeBox {
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * The single fail-closed predicate both the tenant-side "do I have an active grant"
 * read and the platform-ops "is this operator request allowed" check share: a grant is
 * active only when it has never been revoked AND its time-box has not yet elapsed.
 * Mirrors `auth_session`/`scim_token`'s own `revoked_at IS NULL AND expires_at > now()`
 * synchronous check-at-use-time convention — no background expiry sweep needed.
 */
export function isBreakglassGrantActive(grant: BreakglassGrantTimeBox, now: Date = new Date()): boolean {
  if (grant.revokedAt !== null) return false;
  return grant.expiresAt.getTime() > now.getTime();
}

/** Classifies why a grant is not currently active — used only to enrich the platform
 * audit trail's denial detail (`reason`), never shown to the tenant. */
export function classifyInactiveBreakglassGrant(grant: BreakglassGrantTimeBox | null, now: Date = new Date()): "no_grant" | "revoked" | "expired" {
  if (!grant) return "no_grant";
  if (grant.revokedAt !== null) return "revoked";
  return grant.expiresAt.getTime() <= now.getTime() ? "expired" : "no_grant";
}
