/**
 * Edit a staff user — B9 tab 1's Edit dialog: name, email, team pills, role
 * pills, each independently optional in the same call.
 *
 * ## Three separate port writes, not one transaction
 *
 * Profile (`UserRepository.updateProfile`), team memberships
 * (`TeamRepository.setMemberships`) and tenant role assignments
 * (`UserRepository.setRoleAssignments`) are three different tables behind two
 * different ports, so — exactly like `SuspendUser`'s own documented
 * limitation — nothing here spans them in one transaction. Each field the
 * caller actually supplied is written in turn (profile, then teams, then
 * roles); a field left `undefined` is not written at all, which is what makes
 * three independent, optional edits expressible as one call instead of three
 * separate dialogs. If an earlier write throws (e.g. the profile's email
 * conflict check), later writes never run — a partial edit surfaces as a
 * rejected promise, never a silent partial success.
 *
 * ## Why the return value always comes from a fresh `findById`
 *
 * `setMemberships` and `setRoleAssignments` do not return a `StaffUser` at
 * all, so no combination of edits reliably has one in hand from its own
 * write. Re-reading once at the end, rather than threading `updateProfile`'s
 * own return value through as a special case, keeps one code path for every
 * combination — including the no-op call, which is not an error: an Edit
 * dialog saved with nothing changed is a legitimate action, not a mistake.
 */

import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import type { TeamRepository } from "../ports/team-repository.js";
import type { StaffUser, UserRepository } from "../ports/user-repository.js";

export interface EditUserInput {
  readonly staffUserId: string;
  readonly tenant: TenantSlug;
  /** The Super Admin performing this edit. `users:manage` is checked before we get here. */
  readonly actorId: string;
  readonly environment: string;
  /** Each of the four below is independently optional — omit a field to leave that aspect of the user unchanged. */
  readonly displayName?: string;
  readonly email?: string;
  readonly teamIds?: readonly string[];
  readonly roleKeys?: readonly string[];
}

export interface EditUserResult {
  /** Always the freshest state after every requested edit — see the module comment on why this is a fresh `findById` rather than any single write's own return value. */
  readonly user: StaffUser;
}

export interface EditUserDeps {
  readonly users: UserRepository;
  readonly teams: TeamRepository;
}

export class EditUser {
  constructor(private readonly deps: EditUserDeps) {}

  async execute(input: EditUserInput): Promise<EditUserResult> {
    const { users, teams } = this.deps;

    if (input.displayName !== undefined || input.email !== undefined) {
      await users.updateProfile(
        input.staffUserId,
        {
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
        },
        { actorId: input.actorId, action: "user.profileEdited", environment: input.environment },
      );
    }

    if (input.teamIds !== undefined) {
      await teams.setMemberships(input.staffUserId, input.teamIds, input.actorId);
    }

    if (input.roleKeys !== undefined) {
      await users.setRoleAssignments(input.staffUserId, input.tenant, input.roleKeys, {
        actorId: input.actorId,
        action: "user.rolesEdited",
        environment: input.environment,
      });
    }

    const user = await users.findById(input.staffUserId);
    if (!user) {
      throw new Error(
        `Cannot return staff user "${input.staffUserId}" after editing: no such user. ` +
          "A user must exist to have been editable at all.",
      );
    }
    return { user };
  }
}
