/**
 * Invite a staff user into a tenant — B9 tab 1's **+ Invite user**.
 *
 * This use case is deliberately one line of real work. `UserRepository.create`
 * (see that port method's own doc comment) already owns the entire policy
 * question of what an invite means: a genuinely new email becomes a fresh
 * `Invited` account, while an email that already belongs to a live `StaffUser`
 * elsewhere in the backoffice (ADR-0006 rule 3 — "one email is one account
 * across the whole backoffice") instead grants that existing account a new
 * `TenantMembership`. Both outcomes are one atomic write inside the adapter.
 * Reimplementing any part of that decision here — say, calling `findByEmail`
 * first and branching on it — would create a second place that has to agree
 * with the port's own contract about what "invite" means, and the two would
 * eventually drift apart.
 */

import type { Clock } from "../../platform/ports/provisioning.js";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import type { StaffUser, UserRepository } from "../ports/user-repository.js";

export interface InviteUserInput {
  readonly email: string;
  readonly displayName: string;
  readonly tenant: TenantSlug;
  /** The Super Admin sending this invite. `users:manage` is checked before we get here. */
  readonly invitedByStaffUserId: string;
  /**
   * Carried for parity with every other B9 tab 1 input, but unused below:
   * unlike `updateProfile` / `setRoleAssignments` / `revokeTenantMembership`,
   * `UserRepository.create` takes no `AuditContext`. Inviting a user is the
   * row's creation, not an audited change to an existing one.
   */
  readonly environment: string;
}

export interface InviteUserResult {
  readonly user: StaffUser;
}

export interface InviteUserDeps {
  readonly users: UserRepository;
  readonly clock: Clock;
}

export class InviteUser {
  constructor(private readonly deps: InviteUserDeps) {}

  async execute(input: InviteUserInput): Promise<InviteUserResult> {
    const user = await this.deps.users.create(
      {
        email: input.email,
        displayName: input.displayName,
        invitedByStaffUserId: input.invitedByStaffUserId,
        at: this.deps.clock.now(),
      },
      input.tenant,
    );
    return { user };
  }
}
