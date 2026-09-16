/**
 * `LocalPasswordProvider` — the throwaway adapter, built to production standard.
 *
 * ADR-0006 rule 4 is blunt about why: this will front a government backoffice for
 * some period, and "temporary" is not a licence for weak authentication. So it
 * implements Argon2id hashing, mandatory TOTP for privileged roles, progressive
 * backoff, account lockout and forced rotation — all of which will be deleted
 * when Entra ID or Keycloak lands, along with the `StaffCredentials` table
 * (rule 3). That deletion is the measure of whether the boundary was real: this
 * file and `ports/credential-repository.ts` go, and nothing else moves.
 *
 * ## Argon2id parameters
 *
 * `m = 19456 KiB (19 MiB)`, `t = 2`, `p = 1` — OWASP's current Argon2id baseline,
 * derived from RFC 9106's second recommended option. The reasoning per knob:
 *
 *  - **19 MiB, 2 passes.** Memory is what makes GPU and ASIC cracking expensive,
 *    so it is the knob to spend on. This pair lands in the tens of milliseconds
 *    per verification on the target hardware — enough that an offline attack on a
 *    leaked table is costly, and low enough that a morning sign-in burst across a
 *    few dozen staff does not queue behind the hash.
 *  - **`p = 1`.** Parallelism above one multiplies the memory pool *per thread*,
 *    and this binding hashes one call per thread. Under concurrent sign-ins on a
 *    shared pod that turns a CPU-hardness setting into a memory-exhaustion
 *    vector, which is a worse trade than the strength it buys.
 *  - **Argon2id, not Argon2i or Argon2d.** The hybrid: Argon2i's side-channel
 *    resistance for the first pass, Argon2d's GPU resistance afterwards. RFC 9106
 *    names it the default for password hashing.
 *
 * The parameters travel inside the PHC string, so raising them later does not
 * invalidate existing hashes — `needsRehash` detects a stale one and it is
 * upgraded transparently on the next successful sign-in.
 *
 * ## Timing and enumeration
 *
 * Unknown email, wrong password and non-active account are one outcome
 * (api.md §3.2) and take the same work: the unknown-email path verifies the
 * supplied secret against a decoy hash carrying the real parameters, so the
 * expensive step happens either way. Skipping it would make an unknown address
 * measurably faster to probe, which is account enumeration by stopwatch.
 *
 * ## Not handled here, deliberately
 *
 * `mustChangePassword` is kept in the credential row and read by the session
 * bootstrap call (api.md §3.2's `GET /auth/session`), not by this port. "Must
 * change password" is not a fact about identity, and putting it in the outcome
 * union would mean `OidcProvider` — where credentials are not ours to rotate —
 * having to answer a question that does not apply to it.
 */

import { hash, parseOptions, verify, type Algorithm } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import type { Clock, TenantRegistry } from "../../../platform/ports/provisioning.js";
import type { Principal } from "../../../platform/tenancy/tenant-context.js";
import type { TenantSlug } from "../../../platform/tenancy/tenant-slug.js";
import { ANONYMOUS_ASSURANCE } from "../../domain/assurance.js";
import {
  afterFailedAttempt,
  afterSuccessfulAttempt,
  backoffDelayMs,
  isLockedOut,
} from "../../domain/lockout.js";
import { resolvePermissions, type Permission } from "../../domain/permissions.js";
import type {
  AuthenticationAttempt,
  AuthenticationOutcome,
  ChallengeResponse,
  IdentityCapabilities,
  IdentityProvider,
  SubjectRef,
} from "../../ports/identity-provider.js";
import type { CredentialRepository, StaffCredential } from "../../ports/credential-repository.js";
import { CHALLENGE_FAILURES_BEFORE_BURN, type ChallengeStore } from "../../ports/session-store.js";
import type { StaffUser, UserRepository } from "../../ports/user-repository.js";
import type { SecurityPolicyRepository } from "../../ports/security-policy-repository.js";
import type { TotpVerifier } from "./totp.js";

/**
 * `Algorithm.Argon2id`. Written as a value rather than imported because
 * `@node-rs/argon2` declares `Algorithm` as an *ambient* const enum, which
 * `verbatimModuleSyntax` cannot reference at a value position. Named here so it
 * is a constant with a comment rather than a `2` in an options object.
 */
const ARGON2ID = 2 as Algorithm;

export interface Argon2idParameters {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
  readonly outputLen: number;
}

/** See the module note for the reasoning behind each number. */
export const ARGON2ID_PARAMETERS: Argon2idParameters = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

/** The value written to `StaffCredentials.passwordAlgorithm`, which a CHECK constraint pins. */
export const PASSWORD_ALGORITHM = "argon2id";

/**
 * The hashing seam.
 *
 * Separate from the provider so the unit suite can inject a trivial hasher:
 * Argon2 is slow *by design*, and a fast pre-commit suite that pays 19 MiB and
 * two passes per assertion is a suite people stop running. The real hasher is
 * exercised by one round-trip test at minimal parameters plus the integration
 * suite.
 */
export interface PasswordHasher {
  readonly algorithm: string;
  hash(plain: string): Promise<string>;
  verify(encoded: string, plain: string): Promise<boolean>;
  /** True when `encoded` was produced with weaker parameters than current policy. */
  needsRehash(encoded: string): boolean;
}

export function createArgon2idHasher(
  parameters: Argon2idParameters = ARGON2ID_PARAMETERS,
): PasswordHasher {
  const options = { ...parameters, algorithm: ARGON2ID };

  return {
    algorithm: PASSWORD_ALGORITHM,

    async hash(plain) {
      return hash(plain, options);
    },

    async verify(encoded, plain) {
      // A malformed stored hash must read as "wrong password", not as a 500. A
      // corrupt row would otherwise be a denial of service against one account
      // and an obvious signal that the row is special.
      try {
        return await verify(encoded, plain, options);
      } catch {
        return false;
      }
    },

    needsRehash(encoded) {
      try {
        const stored = parseOptions(encoded);
        return (
          stored.memoryCost < parameters.memoryCost ||
          stored.timeCost < parameters.timeCost ||
          stored.algorithm !== ARGON2ID
        );
      } catch {
        // Unparseable means it was not written by this adapter's current policy,
        // so it needs replacing by definition.
        return true;
      }
    },
  };
}

/**
 * Permissions whose holders must present a second factor (ADR-0006 rule 4).
 *
 * Publishing and user management, because those are the two actions that cannot
 * be undone by fixing a mistake: a published agent has already answered citizens,
 * and a granted role has already been used. Everything else is recoverable, and
 * requiring TOTP of every Live Agent would buy little and cost enrolment support
 * across the whole workforce.
 */
export const SECOND_FACTOR_PERMISSIONS: readonly Permission[] = ["agents:publish", "users:manage"];

/**
 * Derived from the *effective* permission set, not from a role name list.
 *
 * B9 tab 3's matrix is editable and custom roles exist, so a role that gains
 * `users:manage` at runtime must start requiring TOTP without anyone editing a
 * list of privileged role names here.
 */
export function requiresSecondFactor(permissions: ReadonlySet<string>): boolean {
  return SECOND_FACTOR_PERMISSIONS.some((permission) => permissions.has(permission));
}

/**
 * The one-shot token that authorises TOTP enrolment for a privileged user who has
 * none (api.md §3.2's `auth.totp_enrolment_required`).
 *
 * A local-adapter concern by construction: under an IdP that owns MFA there is
 * nothing to enrol, so this seam is declared here and disappears with the file.
 */
export interface EnrolmentTokenIssuer {
  issue(staffUserId: string): Promise<string>;
  /** Single use. Returns the staff user id, or null for a spent, expired or invented token. */
  consume(token: string): Promise<string | null>;
}

export interface LocalPasswordProviderDeps {
  readonly users: UserRepository;
  readonly credentials: CredentialRepository;
  readonly challenges: ChallengeStore;
  readonly hasher: PasswordHasher;
  readonly totp: TotpVerifier;
  readonly enrolment: EnrolmentTokenIssuer;
  readonly clock: Clock;
  /**
   * How the progressive backoff is actually applied. Injected so the unit suite
   * asserts the schedule without waiting for it — a backoff that is only tested
   * by a sleeping test is a backoff nobody tests.
   */
  readonly delay: (milliseconds: number) => Promise<void>;
  /**
   * The Security tab's tenant-editable lockout thresholds (`domain/lockout.ts`'s
   * hardcoded defaults otherwise). Resolved against the ambient tenant `runWithTenant`
   * already bound before `SignIn.execute()` reaches this adapter (`StaffUser.homeTenant`,
   * `next-request-context.ts`'s `signInWithPassword` doc comment) — so it is always the
   * SIGNING-IN user's own tenant's policy, never a caller-supplied one.
   */
  readonly securityPolicy: SecurityPolicyRepository;
  /**
   * Checked in `resolveTenant()` and `resolvePrincipal()` so a `Suspended`/non-`Active`
   * tenant refuses both a fresh sign-in and every subsequent per-request re-check — the
   * platform-admin wave's `SuspendTenant` (`modules/platform/application/suspend-tenant.ts`)
   * also destroys every live session, but a request already in flight, or a sign-in attempt
   * that arrives after that destroy but is otherwise valid, must be refused here too. Without
   * this, "Suspend" would only end sessions that already existed at the moment of suspension.
   */
  readonly tenantRegistry: TenantRegistry;
}

/** How long a challenge stays open. Long enough to read a code off a phone, and no longer. */
const CHALLENGE_TTL_MS = 5 * 60_000;

const REJECT_INVALID: AuthenticationOutcome = {
  kind: "rejected",
  reason: "invalid_credentials",
};

const REJECT_LOCKED: AuthenticationOutcome = { kind: "rejected", reason: "locked" };

const REJECT_CHALLENGE: AuthenticationOutcome = {
  kind: "rejected",
  reason: "challenge_invalid",
};

export class LocalPasswordProvider implements IdentityProvider {
  /** Lazily built, then reused. Building it costs one real hash, so it is not done at import. */
  private decoy: Promise<string> | null = null;

  constructor(private readonly deps: LocalPasswordProviderDeps) {}

  capabilities(): IdentityCapabilities {
    return {
      supportsSelfServicePasswordChange: true,
      supportsEnrolment: true,
      mfaOwnedByProvider: false,
    };
  }

  async authenticate(attempt: AuthenticationAttempt): Promise<AuthenticationOutcome> {
    const { users, credentials, hasher, clock } = this.deps;
    const now = clock.now();
    const policy = await this.deps.securityPolicy.ensureTenantConfig(now);

    const user = await users.findByEmail(attempt.identifier.trim().toLowerCase());
    if (!user || user.status !== "Active") {
      await this.burnEquivalentWork(attempt.secret);
      return REJECT_INVALID;
    }

    const credential = await credentials.find(user.id);
    if (!credential) {
      // No credential row is the normal state under SSO and for an unaccepted
      // invitation. Indistinguishable from a wrong password, or the absence
      // becomes the enumeration oracle the identical response exists to close.
      await this.burnEquivalentWork(attempt.secret);
      return REJECT_INVALID;
    }

    if (isLockedOut(credential.lockout, now)) return REJECT_LOCKED;

    const correct = await hasher.verify(credential.passwordHash, attempt.secret);
    if (!correct) {
      const next = afterFailedAttempt(
        credential.lockout,
        now,
        policy.lockoutFailuresBeforeLock,
        policy.lockoutDurationMinutes * 60_000,
      );
      await credentials.recordLockout(user.id, next);
      // The delay is the backoff. Applied after the write so a client that
      // disconnects mid-wait still had its attempt counted.
      await this.deps.delay(backoffDelayMs(next.failedAttemptCount, policy.backoffCeilingSeconds * 1_000));
      return next.lockedUntil ? REJECT_LOCKED : REJECT_INVALID;
    }

    await credentials.recordLockout(user.id, afterSuccessfulAttempt());
    await this.upgradeHashIfStale(credential, attempt.secret, now);

    const tenant = await this.resolveTenant(user, attempt.tenant);
    if (!tenant) return REJECT_INVALID;

    const principal = await this.principalFor(user, tenant);

    if (!requiresSecondFactor(principal.permissions)) {
      return { kind: "authenticated", principal };
    }

    if (!credential.totpSecret) {
      // A privileged role with no authenticator: forced enrolment, and no session
      // of any kind until it is done (ADR-0006 rule 4).
      return {
        kind: "enrolment_required",
        enrolmentToken: await this.deps.enrolment.issue(user.id),
      };
    }

    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    const challenge = await this.deps.challenges.issue(
      {
        staffUserId: user.id,
        tenant,
        expiresAt,
      },
      now,
    );

    return {
      kind: "challenge_required",
      challengeId: challenge.id,
      method: "totp",
      subject: { subjectId: user.id, tenant },
      expiresAt,
    };
  }

  async completeChallenge(
    challengeId: string,
    response: ChallengeResponse,
  ): Promise<AuthenticationOutcome> {
    const { challenges, credentials, users, totp, clock } = this.deps;
    const now = clock.now();

    const challenge = await challenges.read(challengeId);
    if (!challenge) return REJECT_CHALLENGE;

    if (now.getTime() >= challenge.expiresAt.getTime()) {
      await challenges.burn(challengeId);
      return REJECT_CHALLENGE;
    }

    if (challenge.failureCount >= CHALLENGE_FAILURES_BEFORE_BURN) {
      await challenges.burn(challengeId);
      return REJECT_CHALLENGE;
    }

    const credential = await credentials.find(challenge.staffUserId);
    if (!credential?.totpSecret) {
      await challenges.burn(challengeId);
      return REJECT_CHALLENGE;
    }

    const verification = await totp.verify({
      subject: challenge.staffUserId,
      secretBase32: credential.totpSecret,
      code: response.code,
    });

    if (verification !== "accepted") {
      // A replayed code counts as a failure. It has to: otherwise an attacker
      // holding one captured code could retry it indefinitely without ever
      // burning the challenge.
      await challenges.recordFailure(challengeId);
      return REJECT_CHALLENGE;
    }

    const user = await users.findById(challenge.staffUserId);
    if (!user || user.status !== "Active") {
      await challenges.burn(challengeId);
      return REJECT_CHALLENGE;
    }

    // Single use: the challenge is spent whether or not the caller goes on to
    // mint a session.
    await challenges.burn(challengeId);

    return {
      kind: "authenticated",
      principal: await this.principalFor(user, challenge.tenant),
    };
  }

  async resolvePrincipal(subject: SubjectRef): Promise<Principal | null> {
    const user = await this.deps.users.findById(subject.subjectId);
    if (!user || user.status !== "Active") return null;

    const memberships = await this.deps.users.membershipsFor(user.id);
    // Membership is re-checked on every request, not just at sign-in: revoking a
    // user's membership of one government entity has to take effect while they
    // are looking at it.
    if (!memberships.includes(subject.tenant)) return null;

    // Same re-check, for the tenant rather than the membership: a tenant suspended
    // after this session began must stop being usable on the very next request, not
    // merely at its next sign-in.
    if (!(await this.isTenantActive(subject.tenant))) return null;

    return this.principalFor(user, subject.tenant);
  }

  async listTotpEnrolmentStatus(staffUserIds: readonly string[]): Promise<ReadonlyMap<string, boolean>> {
    return this.deps.credentials.listEnrolmentStatus(staffUserIds);
  }

  async resetTotpEnrolment(staffUserId: string, at: Date): Promise<void> {
    await this.deps.credentials.clearTotp(staffUserId, at);
  }

  /**
   * Build the `Principal`.
   *
   * The whole of authorization enters here and nowhere else: roles for the
   * tenant, the tenant's live matrix, union across roles, deny by default. Under
   * OIDC only the first of those three reads changes — group claims instead of
   * `UserRoleAssignments` — which is ADR-0006 rule 7 in one method.
   */
  private async principalFor(user: StaffUser, tenant: TenantSlug): Promise<Principal> {
    const [roles, matrix] = await Promise.all([
      this.deps.users.rolesFor(user.id, tenant),
      this.deps.users.permissionMatrix(tenant),
    ]);

    return {
      id: user.id,
      tenant,
      displayName: user.displayName,
      roles,
      permissions: resolvePermissions(roles, matrix),
      // Staff hold no citizen assurance. `L0` is the truthful answer, not a
      // placeholder: nothing about a backoffice sign-in verifies an Emirates ID.
      assurance: ANONYMOUS_ASSURANCE,
    };
  }

  /**
   * Which tenant the session binds to.
   *
   * A requested tenant is honoured only if `TenantMemberships` already grants it.
   * That is what keeps ADR-0002 rule 1 intact: the request may choose among
   * tenants the server has already authorised, and naming any other one fails
   * exactly like a wrong password.
   */
  private async resolveTenant(
    user: StaffUser,
    requested: TenantSlug | null,
  ): Promise<TenantSlug | null> {
    const memberships = await this.deps.users.membershipsFor(user.id);
    const candidate = requested
      ? (memberships.includes(requested) ? requested : null)
      : (memberships.includes(user.homeTenant) ? user.homeTenant : null);
    if (!candidate) return null;

    // A membership can be real while the tenant itself is Suspended/Deprovisioned —
    // without this, a fresh sign-in would still succeed for a tenant `SuspendTenant`
    // (platform-admin wave) already flipped out of `Active`.
    return (await this.isTenantActive(candidate)) ? candidate : null;
  }

  private async isTenantActive(tenant: TenantSlug): Promise<boolean> {
    const row = await this.deps.tenantRegistry.findBySlug(tenant);
    return row?.status === "Active";
  }

  /**
   * Re-hash on sign-in when the stored parameters are below current policy.
   *
   * This is the only moment the plaintext is available, so it is the only moment
   * an upgrade is possible without asking the user to change their password. A
   * failure here is logged by the repository and must not fail the sign-in: the
   * old hash is still correct, merely cheaper than we would now like.
   */
  private async upgradeHashIfStale(
    credential: StaffCredential,
    plain: string,
    now: Date,
  ): Promise<void> {
    if (!this.deps.hasher.needsRehash(credential.passwordHash)) return;

    await this.deps.credentials.replacePassword({
      staffUserId: credential.staffUserId,
      passwordHash: await this.deps.hasher.hash(plain),
      passwordAlgorithm: this.deps.hasher.algorithm,
      at: now,
      // An automatic re-hash is not a rotation the user asked for, so it must not
      // start demanding a password change.
      mustChangePassword: credential.mustChangePassword,
    });
  }

  /**
   * Spend the same work on an unknown account as on a real one.
   *
   * The decoy is a hash of random bytes carrying the live parameters, so the
   * verification cost matches to within noise. Built once per process and reused;
   * building it eagerly would put a 19 MiB hash in module initialisation.
   */
  private async burnEquivalentWork(secret: string): Promise<void> {
    this.decoy ??= this.deps.hasher.hash(randomBytes(32).toString("base64url"));
    await this.deps.hasher.verify(await this.decoy, secret);
  }
}
