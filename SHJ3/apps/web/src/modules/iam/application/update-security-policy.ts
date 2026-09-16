/**
 * Save the Security tab's session/lockout policy form.
 *
 * Client-side-mirrored validation is re-checked here too (never trust the client alone):
 * `CK_SecurityPolicies_ranges`'s exact application-layer mirror from
 * `domain/security-policy.ts`, so a bad submit fails with a named reason instead of a raw
 * database constraint error.
 */

import {
  isBackoffCeilingSecondsValid,
  isLockoutDurationMinutesValid,
  isLockoutFailuresBeforeLockValid,
  isStaffSessionAbsoluteHoursValid,
  isStaffSessionIdleMinutesValid,
} from "../domain/security-policy.js";
import type {
  SecurityPolicyRepository,
  SecurityPolicyRow,
  UpdateSecurityPolicyInput as RepositoryUpdateInput,
} from "../ports/security-policy-repository.js";

export type UpdateSecurityPolicyInput = RepositoryUpdateInput;

export type UpdateSecurityPolicyResult =
  | { readonly ok: true; readonly policy: SecurityPolicyRow }
  | { readonly ok: false; readonly reason: "security.value_out_of_range" };

export interface UpdateSecurityPolicyDeps {
  readonly securityPolicy: SecurityPolicyRepository;
}

export class UpdateSecurityPolicy {
  constructor(private readonly deps: UpdateSecurityPolicyDeps) {}

  async execute(input: UpdateSecurityPolicyInput): Promise<UpdateSecurityPolicyResult> {
    if (
      !isStaffSessionIdleMinutesValid(input.staffSessionIdleMinutes) ||
      !isStaffSessionAbsoluteHoursValid(input.staffSessionAbsoluteHours) ||
      !isLockoutFailuresBeforeLockValid(input.lockoutFailuresBeforeLock) ||
      !isLockoutDurationMinutesValid(input.lockoutDurationMinutes) ||
      !isBackoffCeilingSecondsValid(input.backoffCeilingSeconds)
    ) {
      return { ok: false, reason: "security.value_out_of_range" };
    }

    await this.deps.securityPolicy.ensureTenantConfig(input.now);
    const policy = await this.deps.securityPolicy.updateTenantConfig(input);
    return { ok: true, policy };
  }
}
