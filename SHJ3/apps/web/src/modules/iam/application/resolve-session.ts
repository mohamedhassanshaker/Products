/**
 * Turn an opaque session id into a `Principal`, on every request.
 *
 * This is the read path ADR-0006 rule 2 is protecting. It is the file that would
 * not change when `LocalPasswordProvider` becomes `OidcProvider`, and the reason
 * "SSO later" is a configuration change: nothing here knows what a password is.
 *
 * ## Everything authorization-relevant is re-read, deliberately
 *
 * Roles, the permission matrix, the user's status and the session epoch are read
 * on **every** request. That is more work than decoding a token, and it buys the
 * three properties the backoffice actually needs (api.md §3.1, §3.6):
 *
 *  - A permission-matrix edit in B9 tab 3 takes effect on the next request rather
 *    than the next login. An editable matrix that lags behind a session is a
 *    matrix an admin cannot trust.
 *  - Suspending a user ends their session *now*. Sessions are also deleted on
 *    suspension, but a request already in flight against another pod has read its
 *    record already — the status and epoch checks are what stop that one.
 *  - Losing a role reduces access immediately, and never escalates it: an unknown
 *    role contributes no permissions (`resolvePermissions`).
 *
 * ## Failure is classified, not collapsed
 *
 * The caller needs to distinguish "sign in again" from "your session was
 * revoked", because api.md §3.6 promises `auth.session_revoked` for a suspended
 * user and that is the difference between a confusing logout and an
 * explicable one. The reasons stay inside the application; what reaches the wire
 * is one of two error codes.
 */

import type { Clock, TenantRegistry } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import {
  bindingMatches,
  isEpochStale,
  sessionExpiry,
  slideSession,
  ttlPolicyFor,
  type ClientBinding,
  type SessionRecord,
} from "../domain/session.js";
import type { IdentityProvider } from "../ports/identity-provider.js";
import type { SessionStore } from "../ports/session-store.js";
import type { UserRepository } from "../ports/user-repository.js";
import type { SecurityPolicyRepository } from "../ports/security-policy-repository.js";

export type ResolveSessionResult =
  | { readonly kind: "active"; readonly principal: Principal; readonly session: SessionRecord }
  /** No such session, or its key has expired out of the store. */
  | { readonly kind: "absent" }
  | { readonly kind: "expired"; readonly reason: "idle" | "absolute" }
  | {
      readonly kind: "revoked";
      /**
       * `stage` is a partial session presented to a route that needs a real one;
       * `binding` is a cookie replayed from a different browser and network;
       * `suspended` and `epoch` are both B9 acting on the account, one via the
       * status column and one via the counter that catches in-flight requests.
       */
      readonly reason:
        | "suspended"
        | "epoch"
        | "stage"
        | "binding"
        | "unknown_subject"
        | "tenant_suspended";
    };

export interface ResolveSessionInput {
  readonly sessionId: string;
  /** The fingerprint of *this* request, compared against the one on the record. */
  readonly client: ClientBinding;
}

export interface ResolveSessionDeps {
  readonly identity: IdentityProvider;
  readonly sessions: SessionStore;
  readonly users: UserRepository;
  readonly clock: Clock;
  /**
   * The Security tab's tenant-editable session-TTL policy. Resolved for a full staff
   * session only — `AuthMiddleware` already binds `runWithTenant` to the cookie's own
   * tenant hint before calling `execute()` (that file's own doc comment), so this always
   * resolves the SAME tenant the session itself is bound to, never a caller-supplied one.
   */
  readonly securityPolicy: SecurityPolicyRepository;
  /**
   * Checked on every request so a `Suspended`/non-`Active` tenant (`SuspendTenant`,
   * the platform-admin wave) ends every request immediately, not only the sessions
   * that existed at the moment of suspension — `destroyAllForTenant` catches those,
   * this catches a request already in flight or a session somehow still alive.
   */
  readonly tenantRegistry: TenantRegistry;
}

export class ResolveSession {
  constructor(private readonly deps: ResolveSessionDeps) {}

  async execute(input: ResolveSessionInput): Promise<ResolveSessionResult> {
    const { identity, sessions, users, clock } = this.deps;
    const now = clock.now();

    const session = await sessions.read(input.sessionId);
    if (!session) return { kind: "absent" };

    // Checked before anything else, so a suspended tenant refuses a partial
    // (TOTP-pending) session exactly as it refuses a full one.
    const tenant = await this.deps.tenantRegistry.findBySlug(session.tenant);
    if (!tenant || tenant.status !== "Active") {
      await sessions.destroy(session.id);
      return { kind: "revoked", reason: "tenant_suspended" };
    }

    // A partial session grants nothing anywhere but the TOTP route, which uses
    // `CompleteTotpChallenge` and not this use case.
    if (session.stage !== "full") {
      return { kind: "revoked", reason: "stage" };
    }

    // Resolved once, reused for both the expiry check below and the `touch()` calls
    // further down, so a single request can never evaluate two different policies.
    const staffPolicyOverride =
      session.kind === "staff"
        ? await this.deps.securityPolicy.ensureTenantConfig(now).then((p) => ({
            idleSeconds: p.staffSessionIdleMinutes * 60,
            absoluteSeconds: p.staffSessionAbsoluteHours * 60 * 60,
          }))
        : undefined;
    const policy = ttlPolicyFor(session.kind, session.stage, staffPolicyOverride);
    const expiry = sessionExpiry(session, policy, now);
    if (expiry !== "active") {
      // Delete rather than leave it to the key's own TTL. The record is provably
      // useless from here, and a store holding useless session records is a store
      // whose contents no longer answer "who is signed in".
      await sessions.destroy(session.id);
      return { kind: "expired", reason: expiry };
    }

    if (!bindingMatches(session.binding, input.client)) {
      await sessions.destroy(session.id);
      return { kind: "revoked", reason: "binding" };
    }

    if (session.kind === "citizen") {
      // Citizens have no roles, no permissions and no user record — they have an
      // assurance level, which lives on the session because that is where
      // verification writes it (api.md §3.5).
      await sessions.touch(slideSession(session, now), now, policy);
      return {
        kind: "active",
        principal: {
          id: session.subjectId,
          tenant: session.tenant,
          displayName: session.displayName,
          roles: [],
          permissions: new Set<string>(),
          assurance: session.assurance,
        },
        session,
      };
    }

    const user = await users.findById(session.subjectId);
    if (!user) {
      await sessions.destroy(session.id);
      return { kind: "revoked", reason: "unknown_subject" };
    }

    // `Invited` is included: an invited user who somehow holds a session has not
    // accepted, and `Suspended` is B9's revocation. Only `Active` continues.
    if (user.status !== "Active") {
      await sessions.destroy(session.id);
      return { kind: "revoked", reason: "suspended" };
    }

    if (isEpochStale(session, user.sessionEpoch)) {
      await sessions.destroy(session.id);
      return { kind: "revoked", reason: "epoch" };
    }

    // The fresh read of roles and the live matrix. Under OIDC this is where group
    // claims become role names, and this line is the only thing that changes.
    const principal = await identity.resolvePrincipal({
      subjectId: session.subjectId,
      tenant: session.tenant,
    });
    if (!principal) {
      await sessions.destroy(session.id);
      return { kind: "revoked", reason: "unknown_subject" };
    }

    // Slide last, so a request that failed any check above does not extend the
    // life of the session it failed on.
    await sessions.touch(slideSession(session, now), now, policy);

    return { kind: "active", principal, session };
  }
}
