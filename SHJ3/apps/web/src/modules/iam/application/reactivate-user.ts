/**
 * Reactivate a suspended staff user.
 *
 * The mirror image of `SuspendUser` — read that file's doc comment first;
 * this one exists only to say precisely how it differs, not to repeat it.
 *
 * ## What is different from `SuspendUser`, and why
 *
 * Reactivation does **not** restore sessions. `SuspendUser`'s own doc comment
 * already states the reasoning candidly: "the user signs in again." A
 * suspension destroys every live session and bumps the epoch; reversing the
 * status does not un-bump the epoch or resurrect a destroyed session record —
 * there is nothing to restore, because signing in is what mints a session in
 * the first place. That is also why `ReactivateUserDeps` carries no
 * `SessionStore` at all: a dependency this use case never calls would be a
 * dead parameter suggesting the wrong behaviour to a future reader.
 *
 * ## What stays the same
 *
 *  1. **Status change and audit entry, in one transaction** (`changeStatus`,
 *     api.md §12 invariant 3) — there is no port method that changes a status
 *     without auditing it, for the same reason `SuspendUser` relies on that.
 *  2. **Idempotent, and silent about it.** Reactivating an already-`Active`
 *     user is a no-op that writes no audit entry — an audit log that records
 *     a reactivation which changed nothing says something happened when
 *     nothing did (identical reasoning to `SuspendUser`'s own idempotency
 *     case).
 *  3. **A missing user throws.** Reactivation is a status transition on an
 *     existing record, never a deletion, matching `SuspendUser`'s own
 *     refusal.
 */

import type { Clock } from "../../platform/ports/provisioning.js";
import type { UserRepository } from "../ports/user-repository.js";

export interface ReactivateUserInput {
  readonly staffUserId: string;
  /** The Super Admin performing this. `users:manage` is checked before we get here. */
  readonly actorId: string;
  readonly environment: string;
  readonly reason?: string;
}

/**
 * Empty: reactivation reports no session count, because — unlike
 * `SuspendUser` — it touches no sessions at all.
 *
 * `Record<string, never>` rather than a literal `{}` interface: this repo's
 * own `no-empty-object-type` lint rule (see `ai-vector-provisioner.ts` for
 * the same idiom used elsewhere) rejects an empty interface body outright, and
 * `Record<string, never>` says the same thing — no properties — in a shape
 * the linter accepts. `{}` still satisfies it as a returned value.
 */
export type ReactivateUserResult = Record<string, never>;

export interface ReactivateUserDeps {
  readonly users: UserRepository;
  readonly clock: Clock;
}

export class ReactivateUser {
  constructor(private readonly deps: ReactivateUserDeps) {}

  async execute(input: ReactivateUserInput): Promise<ReactivateUserResult> {
    const { users, clock } = this.deps;

    const user = await users.findById(input.staffUserId);
    if (!user) {
      throw new Error(
        `Cannot reactivate staff user "${input.staffUserId}": no such user. ` +
          "Reactivation is a status transition on an existing record, never a deletion.",
      );
    }

    // A no-op reactivation would still write an audit entry for a transition
    // that did not happen.
    if (user.status === "Active") {
      return {};
    }

    await users.changeStatus({
      staffUserId: input.staffUserId,
      status: "Active",
      at: clock.now(),
      audit: {
        actorId: input.actorId,
        action: "user.reactivated",
        environment: input.environment,
        detail: {
          previousStatus: user.status,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
      },
    });

    return {};
  }
}
