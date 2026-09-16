/**
 * The real `VerificationConfigRepository` — the `VerificationConfigs`
 * singleton, per-tenant. `getOrCreate`-shaped: a fresh tenant that never
 * visited B11 tab 1 still reads a working default (check enabled, no reason).
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  VerificationConfigRepository,
  VerificationConfigRow,
} from "../../../ports/verification-config-repository.js";

const OPERATION = "identity verification-config repository";
const SINGLETON_KEY = 1;

function toRow(row: {
  accountOwnershipCheckEnabled: boolean;
  ownershipCheckDisabledReason: string | null;
  ownershipCheckLastChangedByStaffUserId: string | null;
  ownershipCheckLastChangedAt: Date | null;
  otpLengthDigits: number;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
}): VerificationConfigRow {
  return { ...row };
}

export class PrismaVerificationConfigRepository implements VerificationConfigRepository {
  async get(): Promise<VerificationConfigRow> {
    const db = getTenantDb(OPERATION);
    const existing = await db.verificationConfig.findUnique({
      where: { singletonKey: SINGLETON_KEY },
    });
    if (existing) return toRow(existing);

    const now = new Date();
    const created = await db.verificationConfig.create({
      data: {
        id: newUlid(now),
        singletonKey: SINGLETON_KEY,
        accountOwnershipCheckEnabled: true,
        otpLengthDigits: 6,
        otpTtlSeconds: 300,
        otpMaxAttempts: 5,
        createdAt: now,
        updatedAt: now,
      },
    });
    return toRow(created);
  }

  async setAccountOwnershipCheck(input: {
    readonly enabled: boolean;
    readonly reason: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<VerificationConfigRow> {
    await this.get(); // ensure the singleton row exists
    const db = getTenantDb(OPERATION);
    const row = await db.verificationConfig.update({
      where: { singletonKey: SINGLETON_KEY },
      data: {
        accountOwnershipCheckEnabled: input.enabled,
        ownershipCheckDisabledReason: input.enabled ? null : input.reason,
        ownershipCheckLastChangedByStaffUserId: input.enabled ? null : input.actorStaffUserId,
        ownershipCheckLastChangedAt: input.enabled ? null : input.now,
        updatedAt: input.now,
      },
    });
    return toRow(row);
  }
}
