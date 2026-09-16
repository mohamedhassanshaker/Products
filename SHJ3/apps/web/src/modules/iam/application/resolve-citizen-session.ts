/**
 * Resolve a citizen session from its opaque id.
 *
 * The citizen-surface sibling of `resolve-session.ts`, deliberately much
 * smaller: a citizen session carries no roles, no permissions and no
 * `StaffUsers` epoch to check, because there is no `Principal` on this path —
 * the widget and WhatsApp never see anything but a `SessionRecord` (`kind:
 * "citizen"`) and its `assurance` level (B11's ladder, `iam/domain/assurance.ts`).
 *
 * Reusing `SessionStore`/`ClientBinding`/`bindingMatches`/`ttlPolicyFor` rather
 * than inventing a parallel mechanism is deliberate: `domain/session.ts`
 * already models `SessionKind = "staff" | "citizen"` and
 * `CITIZEN_SESSION_TTL` for exactly this case (built alongside the staff path,
 * never wired to a caller until B-6). One store, one binding check, one expiry
 * rule — the only thing that differs per kind is the TTL policy and what the
 * caller does with the result.
 *
 * No vendor imports (architecture.md §4): the store is a port.
 */

import type { Clock } from "../../platform/ports/provisioning.js";
import {
  ttlPolicyFor,
  bindingMatches,
  isSessionExpired,
  slideSession,
  type ClientBinding,
  type SessionRecord,
} from "../domain/session.js";
import type { SessionStore } from "../ports/session-store.js";

export interface ResolveCitizenSessionInput {
  readonly sessionId: string;
  readonly client: ClientBinding;
}

export type ResolveCitizenSessionResult =
  | { readonly kind: "absent" }
  | { readonly kind: "expired" }
  | { readonly kind: "binding_mismatch" }
  | { readonly kind: "active"; readonly session: SessionRecord };

export interface ResolveCitizenSessionDeps {
  readonly sessions: SessionStore;
  readonly clock: Clock;
}

export class ResolveCitizenSession {
  constructor(private readonly deps: ResolveCitizenSessionDeps) {}

  async execute(input: ResolveCitizenSessionInput): Promise<ResolveCitizenSessionResult> {
    const { sessions, clock } = this.deps;
    const now = clock.now();

    const session = await sessions.read(input.sessionId);
    // Absent, or a staff session id replayed on the citizen cookie (cannot
    // normally happen — the cookies are namespaced separately — but a store
    // that could tell "wrong kind" apart from "does not exist" would leak
    // which ids are real, the same reasoning `SessionStore.read`'s own doc
    // comment gives for the not-found/expired case.
    if (!session || session.kind !== "citizen") return { kind: "absent" };

    const ttl = ttlPolicyFor("citizen", session.stage);
    if (isSessionExpired(session, ttl, now)) return { kind: "expired" };
    if (!bindingMatches(session.binding, input.client)) return { kind: "binding_mismatch" };

    const slid = slideSession(session, now);
    await sessions.touch(slid, now);
    return { kind: "active", session: slid };
  }
}
