/**
 * Force TOTP re-enrolment for one staff user — the Security tab's per-row "Reset"
 * action (e.g. after a lost device). Goes through `IdentityProvider`, never
 * `CredentialRepository` directly (that port's own doc comment: "no application
 * module and no feature module may import this file" — `LocalPasswordProvider` is
 * its one sanctioned consumer).
 *
 * Does not disable the second-factor requirement itself, and does not revoke the
 * user's current session — see `IdentityProvider.resetTotpEnrolment`'s own doc
 * comment for why this is a prospective "next sign-in re-enrols" change, not an
 * immediate sign-out.
 */

import type { IdentityProvider } from "../ports/identity-provider.js";

export interface ResetStaffTotpInput {
  readonly staffUserId: string;
  readonly now: Date;
}

export interface ResetStaffTotpDeps {
  readonly identity: IdentityProvider;
}

export class ResetStaffTotp {
  constructor(private readonly deps: ResetStaffTotpDeps) {}

  async execute(input: ResetStaffTotpInput): Promise<void> {
    await this.deps.identity.resetTotpEnrolment(input.staffUserId, input.now);
  }
}
