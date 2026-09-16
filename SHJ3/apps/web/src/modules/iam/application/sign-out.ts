/**
 * End a session, or all of a principal's sessions.
 *
 * Four lines of logic that only exist because ADR-0006 rule 2 chose server-side
 * sessions. With a JWT, `signOut` would be a client-side cookie deletion and a
 * promise that the token will expire eventually — which is not sign-out, and
 * would not satisfy a government backoffice's expectation that logging out on a
 * shared machine means logged out.
 *
 * `everywhere` backs api.md §3.2's `DELETE /auth/sessions`. It is also what
 * password rotation calls: rotating a credential must invalidate the sessions
 * established with the old one, or the rotation protects nothing.
 */

import type { SessionStore } from "../ports/session-store.js";

export interface SignOutDeps {
  readonly sessions: SessionStore;
}

export class SignOut {
  constructor(private readonly deps: SignOutDeps) {}

  /**
   * Destroy one session.
   *
   * Idempotent, and silent about whether the id existed. A caller signing out
   * twice, or with a stale cookie, is not an error worth reporting — and
   * reporting it would tell an unauthenticated caller whether a guessed id was
   * real.
   */
  async execute(sessionId: string): Promise<void> {
    await this.deps.sessions.destroy(sessionId);
  }

  /** Destroy every session for one subject. Returns how many were revoked, for the audit entry. */
  async everywhere(subjectId: string): Promise<number> {
    return this.deps.sessions.destroyAllForSubject(subjectId);
  }
}
