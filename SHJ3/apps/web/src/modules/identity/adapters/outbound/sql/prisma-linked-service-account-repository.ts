/**
 * The real `LinkedServiceAccountRepository` — `LinkedServiceAccounts`, per-tenant.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  LinkedServiceAccountRepository,
  LinkedServiceAccountRow,
} from "../../../ports/linked-service-account-repository.js";

const OPERATION = "identity linked-service-account repository";

function toRow(row: {
  id: string;
  citizenIdentityId: string;
  providerKey: string;
  accountNumberMasked: string;
  accountNumberHash: string;
  ownershipVerified: boolean;
  ownershipVerifiedAt: Date | null;
  ownershipVerifiedVia: string | null;
  linkedAt: Date;
  unlinkedAt: Date | null;
}): LinkedServiceAccountRow {
  return { ...row };
}

export class PrismaLinkedServiceAccountRepository implements LinkedServiceAccountRepository {
  async findActive(
    citizenIdentityId: string,
    providerKey: string,
    accountNumberHash: string,
  ): Promise<LinkedServiceAccountRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.linkedServiceAccount.findFirst({
      where: { citizenIdentityId, providerKey, accountNumberHash, unlinkedAt: null },
    });
    return row ? toRow(row) : null;
  }

  async link(input: {
    readonly citizenIdentityId: string;
    readonly providerKey: string;
    readonly accountNumberMasked: string;
    readonly accountNumberHash: string;
    readonly ownershipVerified: boolean;
    readonly ownershipVerifiedVia: string | null;
    readonly now: Date;
  }): Promise<LinkedServiceAccountRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.linkedServiceAccount.create({
      data: {
        id: newUlid(input.now),
        citizenIdentityId: input.citizenIdentityId,
        providerKey: input.providerKey,
        accountNumberMasked: input.accountNumberMasked,
        accountNumberHash: input.accountNumberHash,
        ownershipVerified: input.ownershipVerified,
        ownershipVerifiedAt: input.ownershipVerified ? input.now : null,
        ownershipVerifiedVia: input.ownershipVerifiedVia,
        linkedAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toRow(row);
  }
}
