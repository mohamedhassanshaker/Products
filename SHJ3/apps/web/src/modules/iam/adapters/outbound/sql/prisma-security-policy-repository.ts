/** The real `SecurityPolicyRepository` — `SecurityPolicies`, per-tenant singleton. */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { SECURITY_POLICY_DEFAULTS } from "../../../domain/security-policy.js";
import type {
  SecurityPolicyRepository,
  SecurityPolicyRow,
  UpdateSecurityPolicyInput,
} from "../../../ports/security-policy-repository.js";

const OPERATION = "security policy repository";

function toRow(row: {
  staffSessionIdleMinutes: number;
  staffSessionAbsoluteHours: number;
  lockoutFailuresBeforeLock: number;
  lockoutDurationMinutes: number;
  backoffCeilingSeconds: number;
  updatedByStaffUserId: string | null;
  updatedAt: Date;
}): SecurityPolicyRow {
  return {
    staffSessionIdleMinutes: row.staffSessionIdleMinutes,
    staffSessionAbsoluteHours: row.staffSessionAbsoluteHours,
    lockoutFailuresBeforeLock: row.lockoutFailuresBeforeLock,
    lockoutDurationMinutes: row.lockoutDurationMinutes,
    backoffCeilingSeconds: row.backoffCeilingSeconds,
    updatedByStaffUserId: row.updatedByStaffUserId,
    updatedAt: row.updatedAt,
  };
}

export class PrismaSecurityPolicyRepository implements SecurityPolicyRepository {
  async ensureTenantConfig(now: Date): Promise<SecurityPolicyRow> {
    const db = getTenantDb(OPERATION);
    const existing = await db.securityPolicy.findFirst();
    if (existing) return toRow(existing);

    const d = SECURITY_POLICY_DEFAULTS;
    const created = await db.securityPolicy.create({
      data: {
        id: newUlid(now),
        staffSessionIdleMinutes: d.staffSessionIdleMinutes,
        staffSessionAbsoluteHours: d.staffSessionAbsoluteHours,
        lockoutFailuresBeforeLock: d.lockoutFailuresBeforeLock,
        lockoutDurationMinutes: d.lockoutDurationMinutes,
        backoffCeilingSeconds: d.backoffCeilingSeconds,
        updatedByStaffUserId: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return toRow(created);
  }

  async updateTenantConfig(input: UpdateSecurityPolicyInput): Promise<SecurityPolicyRow> {
    const db = getTenantDb(OPERATION);
    const existing = await db.securityPolicy.findFirstOrThrow();
    const updated = await db.securityPolicy.update({
      where: { id: existing.id },
      data: {
        staffSessionIdleMinutes: input.staffSessionIdleMinutes,
        staffSessionAbsoluteHours: input.staffSessionAbsoluteHours,
        lockoutFailuresBeforeLock: input.lockoutFailuresBeforeLock,
        lockoutDurationMinutes: input.lockoutDurationMinutes,
        backoffCeilingSeconds: input.backoffCeilingSeconds,
        updatedByStaffUserId: input.updatedByStaffUserId,
        updatedAt: input.now,
      },
    });
    return toRow(updated);
  }
}
