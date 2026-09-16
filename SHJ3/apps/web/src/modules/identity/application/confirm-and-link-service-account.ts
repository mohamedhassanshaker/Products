/**
 * B11 tab 1's account-ownership check — "the single most consequential toggle
 * in the prototype" (`docs/data-model.md` §4.11). A2 step 3's
 * `awaiting slot: account_number` is the citizen-visible seam this use case
 * sits behind.
 *
 * With `VerificationConfigs.accountOwnershipCheckEnabled` on (the default),
 * the supplied account number must resolve to the verified identity via
 * `VerificationProvider.confirmAccountOwnership` — `unavailable` fails closed
 * exactly like `not_matched` (the port's own doc comment: an outage must never
 * read as "this account is yours," nor may it silently read as "not yours"
 * without being distinguishable from a real mismatch for paging purposes).
 * With the toggle off, the account is linked unverified — the toggle's whole
 * point, and why disabling it requires a reason and an audited actor
 * (`CK_VerificationConfigs_disableNeedsReason`).
 */

import type {
  AccountRef,
  VerifiedIdentity,
  VerificationProvider,
} from "../../iam/ports/verification-provider.js";
import type {
  LinkedServiceAccountRepository,
  LinkedServiceAccountRow,
} from "../ports/linked-service-account-repository.js";
import type { VerificationConfigRepository } from "../ports/verification-config-repository.js";

export type ConfirmAndLinkResult =
  | { readonly ok: true; readonly account: LinkedServiceAccountRow }
  | {
      readonly ok: false;
      readonly reason:
        "verification.ownership_check_failed" | "verification.ownership_check_unavailable";
    };

export interface ConfirmAndLinkServiceAccountInput {
  readonly citizenIdentityId: string;
  readonly identity: VerifiedIdentity;
  readonly account: AccountRef;
  /** How the caller masks a raw account number for the stored column — kept out of this use case's own logic so masking policy stays in one place. */
  readonly accountNumberMasked: string;
  readonly accountNumberHash: string;
  readonly now: Date;
}

export interface ConfirmAndLinkServiceAccountDeps {
  readonly provider: VerificationProvider;
  readonly config: VerificationConfigRepository;
  readonly linkedAccounts: LinkedServiceAccountRepository;
}

export class ConfirmAndLinkServiceAccount {
  constructor(private readonly deps: ConfirmAndLinkServiceAccountDeps) {}

  async execute(input: ConfirmAndLinkServiceAccountInput): Promise<ConfirmAndLinkResult> {
    const { provider, config, linkedAccounts } = this.deps;
    const verificationConfig = await config.get();

    if (!verificationConfig.accountOwnershipCheckEnabled) {
      const account = await linkedAccounts.link({
        citizenIdentityId: input.citizenIdentityId,
        providerKey: input.account.serviceKind,
        accountNumberMasked: input.accountNumberMasked,
        accountNumberHash: input.accountNumberHash,
        ownershipVerified: false,
        ownershipVerifiedVia: null,
        now: input.now,
      });
      return { ok: true, account };
    }

    const ownership = await provider.confirmAccountOwnership(input.identity, input.account);

    if (ownership.reason === "unavailable") {
      return { ok: false, reason: "verification.ownership_check_unavailable" };
    }
    if (!ownership.matched) {
      return { ok: false, reason: "verification.ownership_check_failed" };
    }

    const account = await linkedAccounts.link({
      citizenIdentityId: input.citizenIdentityId,
      providerKey: input.account.serviceKind,
      accountNumberMasked: input.accountNumberMasked,
      accountNumberHash: input.accountNumberHash,
      ownershipVerified: true,
      ownershipVerifiedVia: "VerificationProvider",
      now: input.now,
    });
    return { ok: true, account };
  }
}
