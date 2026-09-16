/**
 * Suspend a staff user, and end their sessions now.
 *
 * B9's `Suspend` is **not** a flag checked at next login (api.md §3.6). This use
 * case is the reason ADR-0006 rule 2 chose opaque server-side sessions over
 * JWTs: with a token, "suspended" would mean "still fully authorised until the
 * token expires", and the honest implementation would be a revocation list —
 * i.e. a server-side session with extra cryptography and worse latency.
 *
 * ## The order of operations, and why each step is where it is
 *
 *  1. **Status change and audit entry, in one transaction.** api.md §12 invariant
 *     3: if the audit insert fails, the change does not happen. Expressed as a
 *     single port call (`changeStatus`) so there is no method available that
 *     changes a status without auditing it.
 *  2. **Bump the session epoch.** Catches a request already in flight on another
 *     pod, which has already read its session record and would otherwise complete.
 *  3. **Destroy the sessions.** After the commit, because signing someone out for
 *     a change that then rolled back would be a support ticket with no cause.
 *
 * Reactivation deliberately does not restore sessions — the user signs in again.
 * Role and permission changes do *not* revoke, because permissions are re-read
 * per request and the change simply takes effect on the next call. Only status
 * changes and password rotation revoke.
 *
 * ## The one thing this cannot promise
 *
 * Steps 1–3 are not one transaction; nothing spans SQL Server and Redis (ADR-0003
 * rule 4). A crash between 1 and 3 leaves a suspended user holding live session
 * records — which the epoch bump in step 2 already neutralises, and which
 * `ResolveSession` rejects on the status read regardless. The failure mode is a
 * stale key that expires on its own, not a usable session.
 */

import type { Clock } from "../../platform/ports/provisioning.js";
import type { SessionStore } from "../ports/session-store.js";
import type { UserRepository } from "../ports/user-repository.js";

export interface SuspendUserInput {
  readonly staffUserId: string;
  /** The Super Admin performing this. `users:manage` is checked before we get here. */
  readonly actorId: string;
  readonly environment: string;
  readonly reason?: string;
}

export interface SuspendUserResult {
  /** How many live sessions were actually destroyed. Recorded so the audit trail is factual. */
  readonly sessionsRevoked: number;
  readonly sessionEpoch: number;
}

export interface SuspendUserDeps {
  readonly users: UserRepository;
  readonly sessions: SessionStore;
  readonly clock: Clock;
}

export class SuspendUser {
  constructor(private readonly deps: SuspendUserDeps) {}

  async execute(input: SuspendUserInput): Promise<SuspendUserResult> {
    const { users, sessions, clock } = this.deps;

    const user = await users.findById(input.staffUserId);
    if (!user) {
      throw new Error(
        `Cannot suspend staff user "${input.staffUserId}": no such user. ` +
          "Suspension is a status transition on an existing record, never a deletion.",
      );
    }

    // A no-op suspension would still write an audit entry and revoke sessions the
    // user does not have, which makes the audit log say something happened when
    // nothing did.
    if (user.status === "Suspended") {
      return { sessionsRevoked: 0, sessionEpoch: user.sessionEpoch };
    }

    await users.changeStatus({
      staffUserId: input.staffUserId,
      status: "Suspended",
      at: clock.now(),
      audit: {
        actorId: input.actorId,
        action: "user.suspended",
        environment: input.environment,
        detail: {
          previousStatus: user.status,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
      },
    });

    const sessionEpoch = await users.bumpSessionEpoch(input.staffUserId);
    const sessionsRevoked = await sessions.destroyAllForSubject(input.staffUserId);

    return { sessionsRevoked, sessionEpoch };
  }
}
