/**
 * The real `CitizenIdentityRepository` — `CitizenIdentities`, per-tenant.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isRequiredAssuranceLevel,
  type RequiredAssuranceLevel,
} from "../../../../tools/domain/tool-catalog.js";
import type {
  CitizenIdentityRepository,
  CitizenIdentityRow,
} from "../../../ports/citizen-identity-repository.js";

const OPERATION = "identity citizen-identity repository";

function toRow(row: {
  id: string;
  assuranceLevel: string;
  emiratesIdHash: string | null;
  mobileHash: string | null;
  displayNameMasked: string | null;
  verifiedByProviderKey: string | null;
  verifiedAt: Date | null;
  verificationExpiresAt: Date | null;
  erasedAt: Date | null;
}): CitizenIdentityRow {
  if (!isRequiredAssuranceLevel(row.assuranceLevel)) {
    throw new Error(`CitizenIdentity ${row.id} has an unrecognized assuranceLevel.`);
  }
  return {
    id: row.id,
    assuranceLevel: row.assuranceLevel,
    emiratesIdHash: row.emiratesIdHash,
    mobileHash: row.mobileHash,
    displayNameMasked: row.displayNameMasked,
    verifiedByProviderKey: row.verifiedByProviderKey,
    verifiedAt: row.verifiedAt,
    verificationExpiresAt: row.verificationExpiresAt,
    erasedAt: row.erasedAt,
  };
}

export class PrismaCitizenIdentityRepository implements CitizenIdentityRepository {
  async findById(id: string): Promise<CitizenIdentityRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.citizenIdentity.findUnique({ where: { id } });
    return row ? toRow(row) : null;
  }

  async findByEmiratesIdHash(emiratesIdHash: string): Promise<CitizenIdentityRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.citizenIdentity.findFirst({
      where: { emiratesIdHash, erasedAt: null },
    });
    return row ? toRow(row) : null;
  }

  async recordVerification(input: {
    readonly citizenIdentityId: string | null;
    readonly assuranceLevel: RequiredAssuranceLevel;
    readonly emiratesIdHash: string | null;
    readonly mobileHash: string | null;
    readonly displayNameMasked: string | null;
    readonly verifiedByProviderKey: string | null;
    readonly verifiedAt: Date | null;
    readonly verificationExpiresAt: Date | null;
    readonly now: Date;
  }): Promise<CitizenIdentityRow> {
    const db = getTenantDb(OPERATION);

    if (input.citizenIdentityId) {
      const row = await db.citizenIdentity.update({
        where: { id: input.citizenIdentityId },
        data: {
          assuranceLevel: input.assuranceLevel,
          emiratesIdHash: input.emiratesIdHash,
          mobileHash: input.mobileHash,
          displayNameMasked: input.displayNameMasked,
          verifiedByProviderKey: input.verifiedByProviderKey,
          verifiedAt: input.verifiedAt,
          verificationExpiresAt: input.verificationExpiresAt,
          updatedAt: input.now,
        },
      });
      return toRow(row);
    }

    const row = await db.citizenIdentity.create({
      data: {
        id: newUlid(input.now),
        assuranceLevel: input.assuranceLevel,
        emiratesIdHash: input.emiratesIdHash,
        mobileHash: input.mobileHash,
        displayNameMasked: input.displayNameMasked,
        verifiedByProviderKey: input.verifiedByProviderKey,
        verifiedAt: input.verifiedAt,
        verificationExpiresAt: input.verificationExpiresAt,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toRow(row);
  }
}
