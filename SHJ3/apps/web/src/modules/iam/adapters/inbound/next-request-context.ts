/**
 * The Next.js App Router "route wrapper" for `AuthMiddleware` — the piece the theming
 * backend wave (2026-09-09) named as missing: *"wiring staff session resolution into the
 * App Router (the already-built, framework-agnostic AuthMiddleware needs a route-level
 * caller that doesn't exist yet) is B-2's [job]."* This is that caller.
 *
 * ## Why every call site binds its own context, rather than one ambient bind point
 *
 * Confirmed empirically before writing this file — a throwaway `next dev` probe (a layout
 * calling `runWithTenant(ctx, () => children)`, a nested page and a nested Server Action
 * both reading `tryGetTenantContext()` with no wrapping of their own, deleted after use):
 * the context bound in the layout reached **neither** the page **nor** the action. Both
 * came back unbound in the real, running app. This matches how Next.js's own
 * `cookies()`/`headers()` behave: they are backed by Next's internal, per-invocation
 * request store, freshly established for every page render *and* separately for every
 * Server Action invocation — never inherited from an earlier render in the same request
 * tree. There is no public hook to piggyback on that internal mechanism, so this module
 * does the equivalent explicitly: every Server Component and every Server Action that
 * needs a `Principal` calls `withStaffAuth()` itself, which builds a fresh `InboundRequest`
 * from `next/headers` (which *does* work identically in both places — Next guarantees it)
 * and drives the real, already-built, framework-agnostic `AuthMiddleware.handle()` — the
 * identical resolve-then-bind-then-run logic every other inbound path in this codebase
 * already uses, just fed from Next's request APIs instead of a hand-built one.
 *
 * This means `settings/appearance/page.tsx`'s and its `actions.ts`'s bare, unwrapped
 * `tryGetTenantContext()`/`requirePrincipal()` calls will keep seeing no context even once
 * real sessions exist elsewhere — a real, out-of-scope gap this file does not fix (it
 * belongs to the theming module's own routes), flagged here rather than silently left for
 * someone to rediscover.
 *
 * ## Why `path` is a placeholder
 *
 * `AuthMiddleware.handle()` reads `request.path` for exactly one decision: whether to read
 * the staff cookie or the citizen one (`path.startsWith("/api/public")`). A Server
 * Component has no built-in way to read the *current* request's own pathname
 * (`usePathname()` is client-only), and a Server Action carries no URL at all — it is
 * invoked by its serialised reference, not a route. Every caller of this module is a
 * `(backoffice)` staff route, which always wants the staff cookie regardless of which one
 * it is, so a fixed, clearly-non-`/api/public` placeholder is supplied — correct for what
 * this one decision actually needs, not a shortcut around a real pathname this module
 * cannot obtain.
 *
 * ## Composition, cached once per process
 *
 * `RedisSessionStore`/`RedisChallengeStore`/`RedisReplayGuard`/`RedisEnrolmentTokenIssuer`
 * (`redis-session-store.ts`) and `PrismaUserRepository`/`PrismaCredentialRepository`
 * already existed as real, production-ready adapters — every dependency
 * `LocalPasswordProvider` (ADR-0006's real local `IdentityProvider`) declares now has a
 * real implementation, which is what makes constructing it here honest rather than a fake
 * standing in for production. None of these objects holds a raw store client directly
 * (every one reaches `getPlatformDb()`/`getTenantDb()`/`getTenantCache()` itself, per
 * ADR-0002 rule 3) — this file only builds the object graph, which is cheap to cache and
 * pointless to reconstruct per request.
 */

import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { Clock, TenantRegistry } from "../../../platform/ports/provisioning.js";
import { PrismaTenantRegistry } from "../../../platform/adapters/outbound/sql/tenant-registry.js";
import { runWithTenant } from "../../../platform/tenancy/tenant-context.js";
import { assertValidSlugShape, type TenantSlug } from "../../../platform/tenancy/tenant-slug.js";
import {
  CompleteTotpChallenge,
  type CompleteTotpChallengeResult,
} from "../../application/complete-totp-challenge.js";
import { ResolveCitizenSession } from "../../application/resolve-citizen-session.js";
import { ResolveSession } from "../../application/resolve-session.js";
import { SignIn, type SignInResult } from "../../application/sign-in.js";
import { SignOut } from "../../application/sign-out.js";
import type { IdentityProvider } from "../../ports/identity-provider.js";
import {
  createArgon2idHasher,
  LocalPasswordProvider,
} from "../outbound/local-password-provider.js";
import {
  RedisChallengeStore,
  RedisEnrolmentTokenIssuer,
  RedisReplayGuard,
  RedisSessionStore,
} from "../outbound/redis-session-store.js";
import { PrismaCredentialRepository } from "../outbound/sql/prisma-credential-repository.js";
import { PrismaUserRepository } from "../outbound/sql/prisma-user-repository.js";
import { PrismaSecurityPolicyRepository } from "../outbound/sql/prisma-security-policy-repository.js";
import { TotpVerifier } from "../outbound/totp.js";
import {
  AuthMiddleware,
  bindingFor,
  formatSessionCookie,
  parseSessionCookie,
  STAFF_SESSION_COOKIE,
  type AuthenticatedRequestContext,
  type InboundRequest,
} from "./auth-middleware.js";

/** See the module comment on why this can never be a real pathname. */
const STAFF_ROUTE_PLACEHOLDER_PATH = "/backoffice/staff-route";

function realClock(): Clock {
  return { now: () => new Date() };
}

function realDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

interface IamCompositionDeps {
  readonly users: PrismaUserRepository;
  readonly sessions: RedisSessionStore;
  readonly identity: LocalPasswordProvider;
  readonly clock: Clock;
  readonly securityPolicy: PrismaSecurityPolicyRepository;
  readonly tenantRegistry: PrismaTenantRegistry;
}

let cachedIamDeps: IamCompositionDeps | undefined;

/**
 * The real IAM object graph, built once per process and shared by every inbound
 * adapter this file exposes — `authMiddleware()` (already-authenticated requests)
 * and `signInWithPassword`/`completeTotpChallengeFromCookie` below (the sign-in
 * route itself, which has no session yet to authenticate *with*, but still needs
 * the identical `LocalPasswordProvider`/`RedisSessionStore`/`PrismaUserRepository`
 * trio). Extracted from `authMiddleware()`'s own former inline body — see git
 * history — precisely so the sign-in route does not grow a second, independently
 * -constructed copy of this graph that could silently drift from this one
 * (`tasks/lessons.md`'s "grep the real thing before trusting a plausible-sounding
 * duplicate" family of lessons, applied here to a composition root instead of a
 * schema or a doc).
 */
function iamDeps(): IamCompositionDeps {
  if (cachedIamDeps) return cachedIamDeps;

  const users = new PrismaUserRepository();
  const replay = new RedisReplayGuard();
  const clock = realClock();
  const sessions = new RedisSessionStore();
  const securityPolicy = new PrismaSecurityPolicyRepository();
  const tenantRegistry = new PrismaTenantRegistry();

  const identity = new LocalPasswordProvider({
    users,
    credentials: new PrismaCredentialRepository(),
    challenges: new RedisChallengeStore(),
    hasher: createArgon2idHasher(),
    totp: new TotpVerifier({ replay, clock }),
    enrolment: new RedisEnrolmentTokenIssuer(),
    clock,
    delay: realDelay,
    securityPolicy,
    tenantRegistry,
  });

  cachedIamDeps = { users, sessions, identity, clock, securityPolicy, tenantRegistry };
  return cachedIamDeps;
}

function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

let cachedMiddleware: AuthMiddleware | undefined;

/**
 * The one process-wide `AuthMiddleware`, shared by every inbound adapter —
 * this file's own staff-facing `withStaffAuth` below, and
 * `public-request-context.ts`'s citizen/anonymous route-handler wrappers
 * (B-6). One instance, one `resolveSession`/`resolveCitizenSession` pair,
 * rather than a second composition root that could silently drift from this
 * one — exported (not just used internally) precisely so the citizen-surface
 * adapter reuses it instead of rebuilding its own.
 */
/**
 * The one canonical `IdentityProvider` — reused by the Security tab's TOTP-admin actions
 * (`ResetStaffTotp`, and the enrolment-status list `iam/actions.ts` reads directly), rather
 * than those actions constructing a second, independently-configured `LocalPasswordProvider`
 * that could silently drift from this one (this file's own doc comment, above).
 */
export function identityProvider(): IdentityProvider {
  return iamDeps().identity;
}

/**
 * The canonical `TenantRegistry` — reused by the platform-admin route's tenant-lifecycle
 * actions (`ListTenants`/`SuspendTenant`/`DeprovisionTenant`) rather than those actions
 * constructing a second instance, for the same "one object graph, not a silently
 * drifting second one" reason `identityProvider()` above already documents.
 */
export function tenantRegistry(): TenantRegistry {
  return iamDeps().tenantRegistry;
}

export function authMiddleware(): AuthMiddleware {
  if (cachedMiddleware) return cachedMiddleware;

  const { identity, sessions, users, clock, securityPolicy, tenantRegistry } = iamDeps();

  cachedMiddleware = new AuthMiddleware({
    resolveSession: new ResolveSession({
      identity,
      sessions,
      users,
      clock,
      securityPolicy,
      tenantRegistry,
    }),
    // Citizen sessions share the same `RedisSessionStore` — `domain/session.ts`'s
    // `SessionKind` already discriminates staff from citizen rows in the same
    // keyspace shape (`{tenant}:session:{id}`), so one store instance serves
    // both resolution paths correctly.
    resolveCitizenSession: new ResolveCitizenSession({ sessions, clock }),
    // The fallback only — a real inbound `traceparent` header wins when present
    // (`extractTraceId`, read inside `AuthMiddleware.handle()` itself).
    newTraceId,
  });
  return cachedMiddleware;
}

/**
 * Build an `InboundRequest` from the current request's real cookies/headers.
 *
 * `query`/`body` are supplied by the caller — a page passes its own `searchParams`, a
 * Server Action passes its own argument object — so `assertNoTenantOverride` (inside
 * `AuthMiddleware.handle()`) genuinely scans what a real caller could have tampered with,
 * not an empty stand-in that would let a forged field through unnoticed.
 */
async function buildInboundRequest(input: {
  readonly method: string;
  readonly query?: Record<string, unknown>;
  readonly body?: unknown;
}): Promise<InboundRequest> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  const cookieRecord: Record<string, string | undefined> = {};
  for (const cookie of cookieStore.getAll()) cookieRecord[cookie.name] = cookie.value;

  const headerRecord: Record<string, string | undefined> = {};
  headerStore.forEach((value, key) => {
    headerRecord[key] = value;
  });

  return {
    method: input.method,
    path: STAFF_ROUTE_PLACEHOLDER_PATH,
    cookies: cookieRecord,
    headers: headerRecord,
    ...(input.query !== undefined ? { query: input.query } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    // `AuthMiddleware`'s own `bindingFor` reads `x-forwarded-for` from `headers` directly;
    // `null` here is the fallback for when that header is absent, which is the only
    // client-address signal a Server Component/Action has access to at all.
    ipAddress: null,
  };
}

/**
 * The `(backoffice)` route group's one entry point into real staff authentication.
 *
 * Call this from a page's Server Component body (`method: "GET"`, pass `searchParams` as
 * `query`) and from every Server Action that needs `principal`/`requirePermission`
 * (`method: "POST"`, pass the action's own argument object as `body`) — never construct
 * `AuthMiddleware` directly, and never call `runWithTenant` from feature code (that rule is
 * `tenant-context.ts`'s own; this function and `AuthMiddleware.handle()` are the only
 * sanctioned callers on the staff-request path).
 *
 * Throws `UnauthenticatedError` (`auth.session_required` / `auth.session_revoked`) for no
 * session or a revoked one, and `TenantForgeryError` for a forged tenant field — callers
 * render around the former (a sign-in prompt, matching `settings/appearance/page.tsx`'s own
 * precedent for "no principal yet") and let the latter surface as the security event it is.
 */
export async function withStaffAuth<T>(
  handler: (context: AuthenticatedRequestContext) => Promise<T>,
  options: {
    readonly method?: string;
    readonly query?: Record<string, unknown>;
    readonly body?: unknown;
  } = {},
): Promise<T> {
  const request = await buildInboundRequest({ method: options.method ?? "GET", ...options });
  return authMiddleware().handle(request, handler);
}

// ---------------------------------------------------------------------------
// The sign-in route's own entry points (`app/[locale]/sign-in`).
//
// Everything above this line assumes a session already exists. These two
// functions are what actually *create* one from real credentials, closing the
// gap this codebase's own doc comments have named since B-2: `mint-session.ts`'s
// module comment ("there is no sign-in page or sign-in API route in this app
// yet"), `PrismaCredentialRepository`'s own doc comment, and this file's earlier
// note that `settings/appearance/page.tsx` had "no principal yet" as its only
// reachable state during development.
// ---------------------------------------------------------------------------

/**
 * A tenant to bind ambiently while resolving identity, before any principal (and
 * therefore any real tenant) is known.
 *
 * `platform.StaffUsers`/`StaffCredentials` are not themselves tenant-scoped, and
 * `getPlatformDb()`'s own gate only checks that *some* `platformScope` context is
 * bound — never the `tenant` value inside it (confirmed by reading that gate
 * directly, not assumed) — so any real, valid tenant slug is safe to use here.
 * This exact "some tenant, value irrelevant" bootstrap pattern already exists
 * independently in `seed-iam-demo-data.ts`'s `runAsBootstrap`,
 * `tests/isolation/setup.ts`'s `runAsProvisioning`, and `mint-session.ts`'s own
 * required `ambientTenant` parameter — all of which use this same `"sewa"` slug.
 */
const SIGN_IN_BOOTSTRAP_TENANT: TenantSlug = assertValidSlugShape("sewa");

/**
 * `Secure` is judged by the browser against the *actual* connection, never a
 * header a server merely claims — `tasks/lessons.md`'s `SameSite=None; Secure`
 * lesson. Mirrors `api/public/v1/conversations/route.ts`'s own
 * `requestWasHttps()`, minus that file's bare-`next dev` URL-protocol fallback
 * (`request.url` does not exist for a Server Action): a TLS-terminating proxy in
 * front of any real deployment sets `X-Forwarded-Proto` — its absence here means
 * either a bare local `http://next dev` (correctly not `Secure`) or a proxy this
 * app does not yet trust, and treating the latter as non-secure is the safe
 * default, not the dangerous one.
 */
function requestIsHttps(headerRecord: Record<string, string | undefined>): boolean {
  const forwardedProto = headerRecord["x-forwarded-proto"];
  return forwardedProto?.split(",")[0]?.trim().toLowerCase() === "https";
}

/**
 * Write the real staff session cookie — the same `{tenant}.{opaqueId}` shape
 * `formatSessionCookie`/`parseSessionCookie` already define, the same
 * `STAFF_SESSION_COOKIE` name `AuthMiddleware.handle()` already reads. Used for
 * both a full session (`signed_in`) and a partial one (`totp_required`) — api.md
 * §3.2 is explicit that the TOTP step's own "partial session cookie" is the
 * identical cookie, just scoped by `ResolveSession`'s own `stage !== "full"`
 * check to grant nothing until the second factor completes.
 *
 * `SameSite=Lax`, unconditionally: unlike the citizen widget cookie (which must
 * work from a genuinely cross-site embed, per `tasks/lessons.md`'s
 * `SameSite=None` lesson), every request that will ever carry this cookie is a
 * first-party navigation or same-origin `fetch()`/Server Action from this app's
 * own backoffice — `Lax` is the correct, narrower default here, not a shortcut.
 */
async function setStaffSessionCookie(
  tenant: TenantSlug,
  sessionId: string,
  expiresAt: Date,
): Promise<void> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const headerRecord: Record<string, string | undefined> = {};
  headerStore.forEach((value, key) => {
    headerRecord[key] = value;
  });

  const maxAgeSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1_000));

  cookieStore.set(STAFF_SESSION_COOKIE, formatSessionCookie(tenant, sessionId), {
    httpOnly: true,
    secure: requestIsHttps(headerRecord),
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export interface SignInWithPasswordInput {
  readonly identifier: string;
  readonly secret: string;
}

/**
 * The password step (api.md §3.2's `POST /auth/sessions`), driven by a real
 * form submission instead of a test script's direct use-case call.
 *
 * ## Why this cannot just be `withStaffAuth` in reverse
 *
 * `RedisSessionStore`'s own `create()`/`read()` (`redis-session-store.ts`) select
 * their physical Redis keyspace from the *ambient* `TenantContext.tenant` bound
 * via `runWithTenant` — never from the `tenant` field written onto the session
 * record itself (confirmed by reading that adapter directly: every call is a
 * bare `getTenantCache()`, no tenant argument). So the session this function
 * creates must already be running inside the **same** tenant that will become
 * this cookie's own tenant-hint half, or `AuthMiddleware.handle()`'s later read
 * — plus its own hard `principal.tenant !== cookie.tenantHint` check — finds
 * nothing / rejects it on the very next page load. A bare email+password form
 * does not know that tenant in advance; it is `StaffUser.homeTenant`, resolved
 * by `LocalPasswordProvider.resolveTenant()` *inside* `SignIn.execute()`. So this
 * function resolves it itself first, with a cheap, platform-scoped, tenant-
 * irrelevant pre-lookup (`SIGN_IN_BOOTSTRAP_TENANT`'s own doc comment), and only
 * then runs the real `SignIn.execute()` inside `runWithTenant` bound to that
 * resolved tenant — the pre-lookup is symmetric for a found and an unknown email
 * alike (same query shape either way), so it adds no enumeration signal on top
 * of `authenticate()`'s own already-constant-time design.
 *
 * `totp_required`'s own result carries no tenant field at all (`sign-in.ts`'s own
 * doc comment: a partial session grants nothing, so its type has no reason to
 * expose one) — the same precomputed value is reused for its cookie, which is
 * safe precisely because `SignIn.execute()` can only ever reach `totp_required`
 * or `signed_in` by resolving the identical `user.homeTenant` this function
 * already read.
 */
export async function signInWithPassword(input: SignInWithPasswordInput): Promise<SignInResult> {
  const request = await buildInboundRequest({ method: "POST" });
  // No `assertNoTenantOverride` here: unlike `withStaffAuth`, this path has no
  // existing tenant scope for a caller to forge into — `identifier`/`secret` are
  // the only inputs, and `DENIED_TENANT_FIELDS` names none of them.
  const client = bindingFor(request);
  const { users, identity, sessions, clock, securityPolicy } = iamDeps();

  const preLookupUser = await runWithTenant(
    {
      tenant: SIGN_IN_BOOTSTRAP_TENANT,
      principal: null,
      traceId: newTraceId(),
      platformScope: "identity",
    },
    () => users.findByEmail(input.identifier.trim().toLowerCase()),
  );
  const targetTenant = preLookupUser?.homeTenant ?? SIGN_IN_BOOTSTRAP_TENANT;

  const result = await runWithTenant(
    { tenant: targetTenant, principal: null, traceId: newTraceId(), platformScope: "identity" },
    () =>
      new SignIn({ identity, sessions, users, clock, securityPolicy }).execute({
        identifier: input.identifier,
        secret: input.secret,
        tenant: null,
        client,
      }),
  );

  if (result.kind === "signed_in") {
    await setStaffSessionCookie(result.principal.tenant, result.sessionId, result.expiresAt);
  } else if (result.kind === "totp_required") {
    await setStaffSessionCookie(targetTenant, result.partialSessionId, result.expiresAt);
  }

  return result;
}

export interface CompleteTotpChallengeFromCookieInput {
  readonly challengeId: string;
  readonly code: string;
}

/**
 * The second factor (api.md §3.2's `POST /auth/sessions/totp`), reading the
 * partial session id from the real cookie `signInWithPassword` already set,
 * exactly as api.md §3.2 describes ("auth: partial session" — the cookie, not a
 * body field). `challengeId` still travels from the client, because it is the
 * one value `SignInResult`'s `totp_required` case actually returns to a caller.
 *
 * Rebinds `runWithTenant` to the cookie's own tenant-hint half before touching
 * the session store, for the identical reason `AuthMiddleware.handle()` does:
 * that hint is what selects the correct Redis keyspace to read from
 * (`signInWithPassword`'s own doc comment). No cookie at all (expired, cleared,
 * or this step opened directly) collapses into the same generic `totp_invalid`
 * rejection `CompleteTotpChallenge` itself returns for an unknown partial id —
 * one honest, undifferentiated "start over" signal either way, matching that use
 * case's own doc comment on why every failure shares one reason.
 */
export async function completeTotpChallengeFromCookie(
  input: CompleteTotpChallengeFromCookieInput,
): Promise<CompleteTotpChallengeResult> {
  const cookieStore = await cookies();
  const parsed = parseSessionCookie(cookieStore.get(STAFF_SESSION_COOKIE)?.value);
  if (!parsed) {
    return { kind: "rejected", reason: "totp_invalid" };
  }

  const { users, identity, sessions, clock, securityPolicy } = iamDeps();

  const result = await runWithTenant(
    {
      tenant: parsed.tenantHint,
      principal: null,
      traceId: newTraceId(),
      platformScope: "identity",
    },
    () =>
      new CompleteTotpChallenge({ identity, sessions, users, clock, securityPolicy }).execute({
        challengeId: input.challengeId,
        partialSessionId: parsed.sessionId,
        code: input.code,
      }),
  );

  if (result.kind === "signed_in") {
    await setStaffSessionCookie(result.principal.tenant, result.sessionId, result.expiresAt);
  }

  return result;
}

/**
 * Clear the staff session cookie outright.
 *
 * Used when the sign-in flow needs to restart at the password step — a burned
 * or expired partial session (`completeTotpChallengeFromCookie`'s own
 * `totp_invalid` collapse means the UI cannot tell that apart from a wrong code,
 * so a user-initiated "start over" is the honest way out) or a real sign-out.
 * Idempotent, and silent about whether a cookie existed — matching `SignOut
 * .execute()`'s own "signing out twice is not an error" reasoning.
 */
export async function clearStaffSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(STAFF_SESSION_COOKIE);
}

/**
 * A real sign-out: destroys the server-side session record (`SignOut.execute`, unused
 * until now — see that class's own doc comment on why a JWT-based sign-out could never
 * be this) and clears the cookie. Idempotent, and silent about whether a session
 * existed, matching `SignOut.execute()`'s own "signing out twice is not an error"
 * reasoning and `clearStaffSessionCookie()`'s identical stance.
 *
 * Reads and rebinds exactly like `completeTotpChallengeFromCookie` — the cookie's own
 * tenant hint selects the Redis keyspace the session record actually lives in.
 */
export async function signOutCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const parsed = parseSessionCookie(cookieStore.get(STAFF_SESSION_COOKIE)?.value);

  if (parsed) {
    const { sessions } = iamDeps();
    await runWithTenant(
      { tenant: parsed.tenantHint, principal: null, traceId: newTraceId(), platformScope: "identity" },
      () => new SignOut({ sessions }).execute(parsed.sessionId),
    );
  }

  await clearStaffSessionCookie();
}
