/**
 * Remove a staff user from one tenant's roster — B9 tab 1's **Remove**.
 *
 * Not a global delete. Read `UserRepository.revokeTenantMembership`'s own doc
 * comment (and the port module's header comment) for the full reasoning:
 * this revokes only `TenantMembership.revokedAt` for `tenant`, leaving the
 * global `StaffUser` row and any other tenant's membership untouched — a
 * person who also works with another government entity keeps that access.
 *
 * ## Order of operations, mirroring `SuspendUser`
 *
 * The SQL change and its audit entry commit first (`revokeTenantMembership`
 * is one atomic write, per that port method's own doc comment); only after
 * that succeeds are this tenant's live sessions destroyed. A removal whose
 * SQL write rolled back must never have signed anyone out for nothing —
 * identical reasoning to `SuspendUser`'s own ordering, and for the same
 * reason: nothing spans SQL Server and Redis in one transaction (ADR-0003
 * rule 4).
 */

import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import type { SessionStore } from "../ports/session-store.js";
import type { UserRepository } from "../ports/user-repository.js";

export interface RemoveUserInput {
  readonly staffUserId: string;
  readonly tenant: TenantSlug;
  /** The Super Admin performing this. `users:manage` is checked before we get here. */
  readonly actorId: string;
  readonly environment: string;
  readonly reason?: string;
}

export interface RemoveUserResult {
  /** How many live sessions were actually destroyed. Recorded so the audit trail is factual. */
  readonly sessionsRevoked: number;
}

export interface RemoveUserDeps {
  readonly users: UserRepository;
  readonly sessions: SessionStore;
}

export class RemoveUser {
  constructor(private readonly deps: RemoveUserDeps) {}

  async execute(input: RemoveUserInput): Promise<RemoveUserResult> {
    const { users, sessions } = this.deps;

    await users.revokeTenantMembership(input.staffUserId, input.tenant, {
      actorId: input.actorId,
      action: "user.removed",
      environment: input.environment,
      // No `previousStatus`-equivalent fact to keep `detail` non-empty (unlike
      // `SuspendUser`/`ReactivateUser`), so an absent reason omits `detail`
      // entirely rather than writing an empty object.
      ...(input.reason === undefined ? {} : { detail: { reason: input.reason } }),
    });

    const sessionsRevoked = await sessions.destroyAllForSubject(input.staffUserId);
    return { sessionsRevoked };
  }
}
