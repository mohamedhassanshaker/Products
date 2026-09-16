/**
 * Pure defaults for `SecurityPolicy` — the Security tab's session/lockout policy form
 * (B9, new tab alongside Users/Teams/Roles). Kept out of the repository/UI so the
 * documented defaults exist in exactly one place.
 *
 * These are exactly the values `modules/iam/domain/{session,lockout}.ts` hardcoded before
 * this table existed — `ensureTenantConfig` seeds a tenant's first-ever row with them, so a
 * tenant that never opens this tab sees no behavior change.
 */
export const SECURITY_POLICY_DEFAULTS = {
  staffSessionIdleMinutes: 30,
  staffSessionAbsoluteHours: 12,
  lockoutFailuresBeforeLock: 5,
  lockoutDurationMinutes: 15,
  backoffCeilingSeconds: 8,
} as const;

/** `CK_SecurityPolicies_ranges`'s client-side mirror. */
export function isStaffSessionIdleMinutesValid(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 10080;
}

export function isStaffSessionAbsoluteHoursValid(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 720;
}

export function isLockoutFailuresBeforeLockValid(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 20;
}

export function isLockoutDurationMinutesValid(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 1440;
}

export function isBackoffCeilingSecondsValid(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 120;
}
