/**
 * Mint a real staff session outside the browser, the same way this codebase's own
 * `PrismaCredentialRepository` module comment says a "live-database proof script" already
 * does: construct `LocalPasswordProvider` (ADR-0006's real local `IdentityProvider`) from
 * its real, production adapters and drive `SignIn`/`CompleteTotpChallenge` directly.
 *
 * ## Why this exists as committed test infrastructure, not a throwaway script
 *
 * `tasks/lessons.md` records that this exact technique was used twice before as a
 * throwaway, deleted-after-use probe (B-2's own live-verification run, and a later
 * bug-fix wave) — because **there is no sign-in page or sign-in API route in this app
 * yet** (`next-request-context.ts`'s own module comment: "B-2 builds no sign-in page").
 * Playwright cannot click through a login form that does not exist, so minting a session
 * this way is not a workaround for this suite — it is the only way to reach an
 * authenticated screen at all, until a real sign-in route ships. Once one does, this file
 * is what gets deleted (or reduced to calling the real endpoint), and every spec that
 * imports it is unaffected — they only ever see a cookie string.
 *
 * ## The client-binding fidelity gap this file is written to avoid — hit a THIRD time here
 *
 * `tasks/lessons.md` records this exact category of mistake costing two prior waves a false
 * "the session is being destroyed" alarm, and names the fix: pin an explicit `User-Agent` at
 * sign-in, then send that *exact* `User-Agent` **and** an explicit `X-Forwarded-For` header
 * on every subsequent request — never rely on either side's defaults happening to agree,
 * and never assume `next dev`'s own guess at a bare request's IP is `"unknown"`.
 *
 * Reading `next-request-context.ts`'s own doc comment first suggested that guess was safe
 * this time — `buildInboundRequest()` hardcodes `ipAddress: null` unconditionally — but a
 * real, live probe against a running `next dev` (this file's own first draft, verified
 * directly rather than trusted) proved the opposite: `bindingFor()` (`auth-middleware.ts`)
 * reads `x-forwarded-for` from the request headers *before* falling back to that `null`, and
 * something in front of `next dev` on this host (not chased further — the fix does not
 * depend on knowing the source) supplies a real `x-forwarded-for` header carrying `"::1"` on
 * every request, matching `tasks/lessons.md`'s own prior finding verbatim. Trusting the
 * hardcoded-`null` reading alone would have shipped every authenticated spec in this suite
 * destroying its own session on the first real request. So: mint every session with an
 * explicit, fixed `ipAddress` (not `null`), and `playwright.config.ts`'s `use.extraHTTPHeaders`
 * sends the identical `X-Forwarded-For` value on every request this suite makes — pinned on
 * both sides, exactly as the lesson prescribes, rather than guessed on either.
 *
 * The user-agent half needs no such pinning: every mainstream browser's UA (Chromium,
 * Firefox, WebKit — every Playwright project this suite uses) starts with `"Mozilla/5.0"`,
 * so `userAgentFamilyOf` always resolves the same `"Mozilla"` family regardless of which
 * browser project a spec runs under, which is why minting with a fixed
 * `"Mozilla/5.0 (…) PlaywrightE2E/1.0"` string is sufficient rather than fragile.
 */

import { randomUUID } from "node:crypto";
import {
  runWithTenant,
  type Principal,
} from "../../apps/web/src/modules/platform/tenancy/tenant-context.js";
import type { TenantSlug } from "../../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import type { Clock } from "../../apps/web/src/modules/platform/ports/provisioning.js";
import { clientBindingOf } from "../../apps/web/src/modules/iam/domain/session.js";
import {
  createArgon2idHasher,
  LocalPasswordProvider,
} from "../../apps/web/src/modules/iam/adapters/outbound/local-password-provider.js";
import {
  RedisChallengeStore,
  RedisEnrolmentTokenIssuer,
  RedisReplayGuard,
  RedisSessionStore,
} from "../../apps/web/src/modules/iam/adapters/outbound/redis-session-store.js";
import { PrismaCredentialRepository } from "../../apps/web/src/modules/iam/adapters/outbound/sql/prisma-credential-repository.js";
import { PrismaUserRepository } from "../../apps/web/src/modules/iam/adapters/outbound/sql/prisma-user-repository.js";
import { PrismaSecurityPolicyRepository } from "../../apps/web/src/modules/iam/adapters/outbound/sql/prisma-security-policy-repository.js";
import { PrismaTenantRegistry } from "../../apps/web/src/modules/platform/adapters/outbound/sql/tenant-registry.js";
import {
  TotpVerifier,
  totpCodeFor,
  totpStepAt,
  TOTP_STEP_SECONDS,
} from "../../apps/web/src/modules/iam/adapters/outbound/totp.js";
import { SignIn } from "../../apps/web/src/modules/iam/application/sign-in.js";
import { CompleteTotpChallenge } from "../../apps/web/src/modules/iam/application/complete-totp-challenge.js";
import {
  formatSessionCookie,
  STAFF_SESSION_COOKIE,
} from "../../apps/web/src/modules/iam/adapters/inbound/auth-middleware.js";

/**
 * The fixed fingerprint every minted session is bound to. See the module comment: every
 * Playwright browser project's real UA reduces to the `"Mozilla"` family regardless of
 * exact string, and `PLAYWRIGHT_CLIENT_IP` is sent as a real `X-Forwarded-For` header on
 * every request this suite makes (`playwright.config.ts`'s `use.extraHTTPHeaders`) — both
 * pinned explicitly rather than guessed, per `tasks/lessons.md`'s documented fix.
 */
/**
 * Exported (not just module-private) so any other script binding a request to one of this
 * suite's pre-minted `storageState` cookies — `scripts/capture-user-guide-screenshots.ts` is
 * the first such consumer — can reuse the exact same value rather than re-typing the literal
 * and risking it silently drifting from this one, per this file's own module comment on why
 * the two sides must always match exactly.
 */
export const E2E_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) PlaywrightE2E/1.0";

/** Must equal `playwright.config.ts`'s `use.extraHTTPHeaders["x-forwarded-for"]` exactly. */
export const PLAYWRIGHT_CLIENT_IP = "127.0.0.1";

function realClock(): Clock {
  return { now: () => new Date() };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Complete a TOTP challenge, retrying across RFC 6238 time steps on a replay rejection.
 *
 * `totp.ts`'s `RedisReplayGuard` correctly refuses to accept the same code twice inside its
 * 90-second window (`TOTP_REPLAY_TTL_SECONDS`) — real anti-replay behaviour, doing its job.
 * It bites here specifically because minting a session is, unlike a human typing a code
 * once, cheap enough to invoke repeatedly in quick succession (found for real: re-running
 * `scripts/mint-e2e-sessions.ts` twice within the same 30-second step while iterating on
 * this suite). A single `globalSetup` run in ordinary use never hits this — the retry exists
 * so a developer re-running the suite mid-iteration doesn't hit a confusing, environment-
 * looking failure for a reason that has nothing to do with the product.
 */
async function completeTotpWithReplayRetry(input: {
  readonly identity: LocalPasswordProvider;
  readonly sessions: RedisSessionStore;
  readonly users: PrismaUserRepository;
  readonly clock: Clock;
  readonly securityPolicy: PrismaSecurityPolicyRepository;
  readonly totpSecretBase32: string;
  readonly challengeId: string;
  readonly partialSessionId: string;
  readonly email: string;
}) {
  const completeTotp = new CompleteTotpChallenge({
    identity: input.identity,
    sessions: input.sessions,
    users: input.users,
    clock: input.clock,
    securityPolicy: input.securityPolicy,
  });

  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const code = totpCodeFor(input.totpSecretBase32, totpStepAt(input.clock.now()));
    const outcome = await completeTotp.execute({
      challengeId: input.challengeId,
      partialSessionId: input.partialSessionId,
      code,
    });

    if (outcome.kind === "signed_in") return outcome;

    if (attempt === MAX_ATTEMPTS) {
      throw new Error(
        `[mint-session] TOTP completion for "${input.email}" was rejected after ${String(MAX_ATTEMPTS)} ` +
          "attempts across RFC 6238 time steps. Check that the seeded TOTP secret " +
          "(E2E_TOTP_SECRET_BASE32) matches what seed-e2e-credentials.ts wrote, and that the " +
          "partial session (5-minute TTL) has not expired.",
      );
    }
    // Wait past the current 30-second step so the next attempt's code is genuinely fresh,
    // rather than the same one the replay guard just refused.
    await sleep(TOTP_STEP_SECONDS * 1_000 + 500);
  }
  // Unreachable — the loop above always returns or throws — but TypeScript cannot see that.
  throw new Error("[mint-session] unreachable: TOTP retry loop exited without returning.");
}

export interface MintSessionInput {
  readonly email: string;
  readonly password: string;
  /** Base32 TOTP seed. Required only for a principal whose effective permissions demand a second factor (ADR-0006 rule 4) — omit for one that does not. */
  readonly totpSecretBase32?: string;
  /**
   * Some tenant to bind as *ambient* context while resolving identity — `platform.
   * StaffUsers`/`StaffCredentials` are not themselves tenant-scoped, but every adapter here
   * still requires *some* bound `TenantContext` to run under (`getPlatformDb()`'s
   * `platformScope` gate). The session that comes out is bound to the **principal's own
   * resolved tenant** (from `TenantMemberships`), not necessarily this one.
   */
  readonly ambientTenant: TenantSlug;
}

export interface MintedSession {
  readonly cookieName: typeof STAFF_SESSION_COOKIE;
  readonly cookieValue: string;
  readonly principal: Principal;
  readonly expiresAt: Date;
}

/**
 * Sign in as a real staff user through the real `LocalPasswordProvider`/`SignIn`/
 * `CompleteTotpChallenge` use cases, completing a TOTP challenge automatically when one is
 * required, and return the exact cookie value `next-request-context.ts` would have set.
 *
 * Requires `pnpm db:seed:iam` and `pnpm db:seed:e2e-credentials` to have already run — this
 * function authenticates against real, previously-seeded data; it does not seed anything
 * itself.
 */
export async function mintStaffSession(input: MintSessionInput): Promise<MintedSession> {
  return runWithTenant(
    {
      tenant: input.ambientTenant,
      principal: null,
      traceId: randomUUID().replace(/-/g, ""),
      platformScope: "identity",
    },
    async () => {
      const users = new PrismaUserRepository();
      const replay = new RedisReplayGuard();
      const clock = realClock();

      const identity = new LocalPasswordProvider({
        users,
        credentials: new PrismaCredentialRepository(),
        challenges: new RedisChallengeStore(),
        hasher: createArgon2idHasher(),
        totp: new TotpVerifier({ replay, clock }),
        enrolment: new RedisEnrolmentTokenIssuer(),
        // Required since the Security tab's session/lockout policy table landed
        // (`next-request-context.ts`'s own `iamDeps()` wires the identical
        // `PrismaSecurityPolicyRepository` in production) — `authenticate()` reads the
        // tenant's lockout policy from here instead of a hardcoded constant, so this
        // mint path needs the same dependency production does.
        securityPolicy: new PrismaSecurityPolicyRepository(),
        // Same reason as `securityPolicy` above: `resolveTenant()`/`resolvePrincipal()` now
        // refuse a Suspended/Deprovisioned tenant (the platform-admin wave's `SuspendTenant`),
        // so this mint path needs the same dependency production does.
        tenantRegistry: new PrismaTenantRegistry(),
        clock,
        delay: () => Promise.resolve(),
      });

      const sessions = new RedisSessionStore();
      // Same reason as `identity` above: `SignIn` now also reads the tenant's
      // session-length policy (idle/absolute) from `SecurityPolicyRepository`
      // rather than `domain/session.ts`'s hardcoded default.
      const securityPolicy = new PrismaSecurityPolicyRepository();
      const signIn = new SignIn({ identity, sessions, users, clock, securityPolicy });

      const client = clientBindingOf(E2E_USER_AGENT, PLAYWRIGHT_CLIENT_IP);

      const outcome = await signIn.execute({
        identifier: input.email,
        secret: input.password,
        tenant: null,
        client,
      });

      if (outcome.kind === "signed_in") {
        return {
          cookieName: STAFF_SESSION_COOKIE,
          cookieValue: formatSessionCookie(outcome.principal.tenant, outcome.sessionId),
          principal: outcome.principal,
          expiresAt: outcome.expiresAt,
        };
      }

      if (outcome.kind !== "totp_required") {
        throw new Error(
          `[mint-session] sign-in for "${input.email}" did not succeed and did not require ` +
            `TOTP either — got "${outcome.kind}". Check that seed-e2e-credentials.ts has run ` +
            "and the password matches E2E_DEMO_PASSWORD.",
        );
      }

      if (!input.totpSecretBase32) {
        throw new Error(
          `[mint-session] "${input.email}" requires a TOTP code to sign in, but no ` +
            "totpSecretBase32 was supplied to mintStaffSession().",
        );
      }

      const totpOutcome = await completeTotpWithReplayRetry({
        identity,
        sessions,
        users,
        clock,
        securityPolicy,
        totpSecretBase32: input.totpSecretBase32,
        challengeId: outcome.challengeId,
        partialSessionId: outcome.partialSessionId,
        email: input.email,
      });

      return {
        cookieName: STAFF_SESSION_COOKIE,
        cookieValue: formatSessionCookie(totpOutcome.principal.tenant, totpOutcome.sessionId),
        principal: totpOutcome.principal,
        expiresAt: totpOutcome.expiresAt,
      };
    },
  );
}
