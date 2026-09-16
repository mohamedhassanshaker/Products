/** `SecurityPolicies` — session/lockout policy, one row per tenant. */

export interface SecurityPolicyRow {
  readonly staffSessionIdleMinutes: number;
  readonly staffSessionAbsoluteHours: number;
  readonly lockoutFailuresBeforeLock: number;
  readonly lockoutDurationMinutes: number;
  readonly backoffCeilingSeconds: number;
  readonly updatedByStaffUserId: string | null;
  readonly updatedAt: Date;
}

export interface UpdateSecurityPolicyInput {
  readonly staffSessionIdleMinutes: number;
  readonly staffSessionAbsoluteHours: number;
  readonly lockoutFailuresBeforeLock: number;
  readonly lockoutDurationMinutes: number;
  readonly backoffCeilingSeconds: number;
  readonly updatedByStaffUserId: string;
  readonly now: Date;
}

export interface SecurityPolicyRepository {
  /** Creates the singleton row with `SECURITY_POLICY_DEFAULTS` on first use. */
  ensureTenantConfig(now: Date): Promise<SecurityPolicyRow>;

  updateTenantConfig(input: UpdateSecurityPolicyInput): Promise<SecurityPolicyRow>;
}
