/**
 * A deliberately minimal, pragmatic email-shape check — ported verbatim from
 * `legacy/api/src/common/util/email.util.ts`. **Not** full registration validation (that belongs to
 * the `auth` module's real DTO validation, a later Phase 1 sub-dispatch) — this exists only so
 * `TenantProvisioningService` can reject an obviously-garbage `adminEmail` input before persisting it
 * and running six provisioning steps against it.
 */
const PLAUSIBLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True if `value` has at least a plausible `local@domain.tld` shape. */
export function isPlausibleEmail(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0 && PLAUSIBLE_EMAIL_PATTERN.test(value.trim());
}
