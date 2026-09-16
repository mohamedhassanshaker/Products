/**
 * `LinkedServiceAccounts` — a utility account a citizen has claimed, and
 * whether ownership was proven (B11 tab 1's account-ownership check; A2 step 3's
 * `awaiting slot: account_number`).
 *
 * `CK_LinkedServiceAccounts_verifiedPaired` and `_maskedNotFull` are the two
 * database-level guarantees this port's `link()` result honours: a row is
 * never `ownershipVerified = true` without a timestamp, and `accountNumberMasked`
 * is never the full, unmasked value.
 */

export interface LinkedServiceAccountRow {
  readonly id: string;
  readonly citizenIdentityId: string;
  readonly providerKey: string;
  readonly accountNumberMasked: string;
  readonly accountNumberHash: string;
  readonly ownershipVerified: boolean;
  readonly ownershipVerifiedAt: Date | null;
  readonly ownershipVerifiedVia: string | null;
  readonly linkedAt: Date;
  readonly unlinkedAt: Date | null;
}

export interface LinkedServiceAccountRepository {
  findActive(
    citizenIdentityId: string,
    providerKey: string,
    accountNumberHash: string,
  ): Promise<LinkedServiceAccountRow | null>;

  link(input: {
    readonly citizenIdentityId: string;
    readonly providerKey: string;
    readonly accountNumberMasked: string;
    readonly accountNumberHash: string;
    readonly ownershipVerified: boolean;
    readonly ownershipVerifiedVia: string | null;
    readonly now: Date;
  }): Promise<LinkedServiceAccountRow>;
}
