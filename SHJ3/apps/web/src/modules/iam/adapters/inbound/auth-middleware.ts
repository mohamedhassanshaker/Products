/**
 * The inbound authentication adapter.
 *
 * Every authenticated request in the system passes through here, and this is the
 * **only** caller of `runWithTenant` on the request path (ADR-0002 rule 2). Its
 * job is narrow and in a fixed order:
 *
 *   reject a forged tenant → resolve the session → build the `Principal` →
 *   bind the tenant context from the principal → run the handler
 *
 * ## The tenant comes from the principal. Not from the request.
 *
 * ADR-0002 rule 1 and api.md §12 invariant 1. `TenantContext.tenant` is set from
 * `principal.tenant`, which came from the session record, which was written at
 * sign-in from `TenantMemberships`. There is no code path from a header, query
 * parameter, route parameter or request body to a tenant.
 *
 * A request that *tries* is rejected rather than ignored — `403
 * authz.tenant_mismatch`, not `422`. A forged tenant is not a validation mistake,
 * and treating it as one would file it as a schema problem instead of a security
 * event. The denied field list is applied here, before any per-route schema runs,
 * so a new route cannot accidentally accept one.
 *
 * ## The cookie's tenant segment, and why it authorises nothing
 *
 * Sessions live at `{tenant}:session:{id}` because Redis has no schemas and its
 * isolation unit is a key prefix (ADR-0002 rule 3). Reading a session therefore
 * requires knowing the prefix *before* the principal exists, which is a genuine
 * chicken-and-egg problem, so the cookie is `{tenant}.{opaqueId}` and the tenant
 * segment is used as a **key-prefix hint** for exactly one Redis read.
 *
 * It is not an authorization input, and three properties make that true rather
 * than merely stated:
 *
 *  1. The id is 256 bits of randomness. Swapping the hint to another tenant looks
 *     up a key that does not exist there, so a forged hint yields no session.
 *  2. The record's own `tenant` field is compared against the hint, and a
 *     mismatch is a hard failure with the session destroyed. The record is the
 *     authority; the hint is a lookup key.
 *  3. What binds to the request is `principal.tenant`, read out of the record.
 *
 * So the hint can select *which prefix is searched* and can never select *which
 * tenant is served*. The tenant is still resolved from the authenticated
 * principal only, which is what the rule requires.
 *
 * ## Framework-agnostic on purpose
 *
 * No Next.js import. This takes an `InboundRequest` — a plain description of what
 * arrived — so the same middleware is exercised by unit tests, by the route
 * wrapper, and by whatever replaces Next's request object (architecture.md §4's
 * agnostic-design rule; the App Router's request type has changed shape twice
 * already).
 */

import { runWithTenant, type Principal } from "../../../platform/tenancy/tenant-context.js";
import {
  assertValidSlugShape,
  isValidSlugShape,
  type TenantSlug,
} from "../../../platform/tenancy/tenant-slug.js";
import { extractTraceId } from "../../../platform/observability/trace-context.js";
import type { ClientBinding, SessionRecord } from "../../domain/session.js";
import { clientBindingOf } from "../../domain/session.js";
import type { ResolveSession, ResolveSessionResult } from "../../application/resolve-session.js";
import type {
  ResolveCitizenSession,
  ResolveCitizenSessionResult,
} from "../../application/resolve-citizen-session.js";

/** The staff cookie (api.md §3.1). `shj3_cs` is the citizen one. */
export const STAFF_SESSION_COOKIE = "shj3_bo";
export const CITIZEN_SESSION_COOKIE = "shj3_cs";

/**
 * Field names that may never appear in a request, at any depth, on any surface.
 *
 * api.md §12 invariant 1 lists exactly these. Denied globally here rather than
 * per route, because a per-route denial is a denial a new route can be written
 * without.
 */
export const DENIED_TENANT_FIELDS: readonly string[] = [
  "tenantId",
  "tenant",
  "entityId",
  "schema",
  "collection",
];

/**
 * How deep the body scan goes.
 *
 * A bounded walk, because the scan runs on untrusted input before any schema has
 * limited its size, and an unbounded recursion over a hostile payload is a denial
 * of service. Ten levels is far beyond any legitimate request body in this API.
 */
const MAX_BODY_SCAN_DEPTH = 10;

/**
 * What the middleware needs to know about an incoming request. Deliberately
 * smaller than any framework's request type: everything here is used.
 */
export interface InboundRequest {
  readonly method: string;
  readonly path: string;
  /** Parsed cookies. The session cookie is the only one read. */
  readonly cookies: Readonly<Record<string, string | undefined>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** Parsed query parameters. Scanned for forged tenant fields, never read for a tenant. */
  readonly query?: Readonly<Record<string, unknown>>;
  /** Parsed body, if any. Scanned for forged tenant fields. */
  readonly body?: unknown;
  /**
   * Client address as the edge resolved it. Used only for the coarse session
   * binding, never for authorization.
   */
  readonly ipAddress: string | null;
}

/**
 * A forged tenant. `403`, `authz.tenant_mismatch`.
 *
 * The message names the rejected field and nothing else — not the principal's
 * actual tenant, not whether the named tenant exists, not whether the addressed
 * resource exists (api.md §12 invariant 1). It is logged at `warn` with the trace
 * id and fires an alert; that wiring belongs to the route wrapper, which is why
 * this carries the field rather than formatting a log line.
 */
export class TenantForgeryError extends Error {
  readonly code = "authz.tenant_mismatch";
  readonly status = 403;

  constructor(readonly rejectedField: string) {
    super(
      "The tenant is resolved from the authenticated principal. " +
        `Remove "${rejectedField}" from the request.`,
    );
    this.name = "TenantForgeryError";
  }
}

/** `401`. No session, or one that is no longer usable. */
export class UnauthenticatedError extends Error {
  readonly status = 401;

  constructor(readonly code: "auth.session_required" | "auth.session_revoked") {
    super(
      code === "auth.session_required"
        ? "This endpoint requires an authenticated session."
        : "The session is no longer valid. Sign in again.",
    );
    this.name = "UnauthenticatedError";
  }
}

/**
 * Reject any request carrying a tenant field.
 *
 * Walks the body and the query exhaustively rather than checking top-level keys:
 * api.md §12 invariant 1 says "anywhere in any body", and a nested
 * `{ filter: { tenantId } }` is the same attempt with one more brace.
 */
export function assertNoTenantOverride(request: InboundRequest): void {
  scanForDeniedFields(request.query, 0);
  scanForDeniedFields(request.body, 0);
}

function scanForDeniedFields(value: unknown, depth: number): void {
  if (depth > MAX_BODY_SCAN_DEPTH || value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) scanForDeniedFields(item, depth + 1);
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (DENIED_TENANT_FIELDS.includes(key)) throw new TenantForgeryError(key);
    scanForDeniedFields(nested, depth + 1);
  }
}

/** `{tenant}.{opaqueId}`, both halves required. */
export interface SessionCookieValue {
  /** A key-prefix hint only. See the module note on why it authorises nothing. */
  readonly tenantHint: TenantSlug;
  readonly sessionId: string;
}

/**
 * Split and validate the cookie.
 *
 * Returns null for anything malformed rather than throwing: a corrupt or
 * hand-edited cookie is an unauthenticated request, not a server error. The
 * tenant half is shape-validated before it is used, because it reaches a Redis key
 * prefix and no unvalidated value may become a store identifier (ADR-0002 rule 4).
 */
export function parseSessionCookie(raw: string | undefined): SessionCookieValue | null {
  if (!raw) return null;

  const separator = raw.indexOf(".");
  if (separator <= 0) return null;

  const tenantHint = raw.slice(0, separator);
  const sessionId = raw.slice(separator + 1);
  if (sessionId.length === 0 || !isValidSlugShape(tenantHint)) return null;

  return { tenantHint: assertValidSlugShape(tenantHint), sessionId };
}

/** Format a session cookie value. The only place the two halves are joined. */
export function formatSessionCookie(tenant: TenantSlug, sessionId: string): string {
  return `${tenant}.${sessionId}`;
}

export interface AuthMiddlewareDeps {
  readonly resolveSession: ResolveSession;
  /**
   * Optional: only the public/citizen surface (B-6) constructs this. Staff-only
   * deployments of this middleware (there are none today, but the type should
   * not force a citizen dependency graph onto every caller) can omit it —
   * `handleCitizenSession` throws a clear configuration error rather than a
   * null-pointer if it is called without one.
   */
  readonly resolveCitizenSession?: ResolveCitizenSession;
  /**
   * The root-trace fallback for `extractTraceId` (platform/observability/trace-
   * context.ts). Correlates this request across shj3-web, shj3-ai and any tool call it
   * makes (architecture.md §10, deployment.md §13.1, ADR-0001 follow-up). Injected,
   * rather than generated inline, purely so a test can pin a deterministic value —
   * production wiring calls `crypto.randomBytes(16).toString("hex")` or equivalent to
   * produce a real 32-hex W3C trace id.
   *
   * This is the *fallback* only. The primary source is an inbound `traceparent` header,
   * read via `extractTraceId`, which is what lets a trace begun at the citizen's browser
   * or at another service survive the hop into this one instead of restarting here.
   */
  readonly newTraceId: () => string;
}

export interface AuthenticatedRequestContext {
  readonly principal: Principal;
  readonly traceId: string;
}

export class AuthMiddleware {
  constructor(private readonly deps: AuthMiddlewareDeps) {}

  /**
   * Authenticate, bind the tenant context, and run the handler inside it.
   *
   * Ordering is not incidental. The forged-tenant check runs **first**, before the
   * session is even read: a request attempting to name a tenant is rejected
   * whether or not its credentials are good, so the rejection cannot be used to
   * probe session validity, and the security event is recorded for anonymous
   * attempts too.
   */
  async handle<T>(
    request: InboundRequest,
    handler: (context: AuthenticatedRequestContext) => Promise<T>,
  ): Promise<T> {
    assertNoTenantOverride(request);

    const cookieName = request.path.startsWith("/api/public")
      ? CITIZEN_SESSION_COOKIE
      : STAFF_SESSION_COOKIE;

    const cookie = parseSessionCookie(request.cookies[cookieName]);
    if (!cookie) throw new UnauthenticatedError("auth.session_required");

    const traceId = extractTraceId(request.headers) ?? this.deps.newTraceId();
    const client = bindingFor(request);

    // The one read that uses the hint. Bound with `principal: null` because there
    // is no principal yet — this context exists solely to give the session store
    // a key prefix, and nothing authorization-relevant runs inside it.
    //
    // `platformScope: "identity"`: `resolveSession.execute()` reads
    // `platform.StaffUsers` (via `UserRepository.findById`, and — inside
    // `IdentityProvider.resolvePrincipal` — `.membershipsFor`) before a principal
    // exists, which is exactly the ordinary, per-request staff-identity access
    // `TenantContext.platformScope`'s own doc comment carves out as a fourth,
    // non-bulk case distinct from provisioning/analytics/migration (added for B-2).
    const resolution: ResolveSessionResult = await runWithTenant(
      { tenant: cookie.tenantHint, principal: null, traceId, platformScope: "identity" },
      async () => this.deps.resolveSession.execute({ sessionId: cookie.sessionId, client }),
    );

    if (resolution.kind === "absent") throw new UnauthenticatedError("auth.session_required");
    if (resolution.kind !== "active") throw new UnauthenticatedError("auth.session_revoked");

    const { principal } = resolution;

    // The record is the authority, the hint was a lookup key. A mismatch cannot
    // normally happen — a record is only reachable under its own prefix — so if it
    // does, something is wrong enough that continuing is not an option.
    if (principal.tenant !== cookie.tenantHint) {
      throw new UnauthenticatedError("auth.session_revoked");
    }

    // The real context. `principal.tenant` is the only source of the tenant, and
    // from here the data-access layer derives every store handle from it.
    //
    // `platformScope: "identity"` here too: the handler itself is where B9's own
    // screens (and any other route) call `UserRepository` methods that touch
    // `platform.StaffUsers` — listing a tenant's staff, reading one by id, and so
    // on. See the identical note on the lookup phase above.
    return runWithTenant(
      { tenant: principal.tenant, principal, traceId, platformScope: "identity" },
      async () => handler({ principal, traceId }),
    );
  }

  /**
   * Bind a context for an anonymous citizen request.
   *
   * B11 tab 2 allows "view bill balance" at `L0`, so anonymous is a legitimate
   * state on the citizen surface and not an error. The tenant is a **parameter**,
   * because it comes from the channel configuration the widget or WhatsApp number
   * belongs to (B10) — resolved server-side from the channel registry, never from
   * the request. That is the same rule as everywhere else: the tenant is
   * server-resolved, and here the server resolves it from the channel rather than
   * from a principal, because there is no principal.
   */
  async handleAnonymous<T>(
    request: InboundRequest,
    channelTenant: TenantSlug,
    handler: (context: { readonly traceId: string }) => Promise<T>,
  ): Promise<T> {
    assertNoTenantOverride(request);

    const traceId = extractTraceId(request.headers) ?? this.deps.newTraceId();

    return runWithTenant({ tenant: channelTenant, principal: null, traceId }, async () =>
      handler({ traceId }),
    );
  }

  /**
   * Resolve an existing citizen conversation session from `shj3_cs`, and bind
   * the tenant it belongs to.
   *
   * Structurally this is `handle()`'s shape (forged-tenant check first, then
   * the session, then bind and run) with the staff-specific pieces removed:
   * there is no `Principal`, no roles/permissions to resolve and no
   * `StaffUsers.sessionEpoch` to compare, because the session record itself
   * (`kind: "citizen"`) is the whole of what a citizen request is authorized
   * to know about itself. The tenant comes from the session record, exactly as
   * it does for staff — never from a request field — which is what lets
   * `OpenConversation` (the only place a tenant is ever taken from a
   * caller-supplied `channelKey`, itself resolved server-side from the channel
   * registry) be the *one* seam where a citizen's tenant is established, with
   * every later request on the same conversation re-deriving it from the
   * session the way `handle()` re-derives a staff tenant from the cookie.
   */
  async handleCitizenSession<T>(
    request: InboundRequest,
    handler: (context: { readonly session: SessionRecord; readonly traceId: string }) => Promise<T>,
  ): Promise<T> {
    assertNoTenantOverride(request);

    if (!this.deps.resolveCitizenSession) {
      throw new Error(
        "handleCitizenSession() called without a resolveCitizenSession dependency — " +
          "the citizen-surface composition root must construct one (see " +
          "modules/iam/application/resolve-citizen-session.ts).",
      );
    }

    const cookie = parseSessionCookie(request.cookies[CITIZEN_SESSION_COOKIE]);
    if (!cookie) throw new UnauthenticatedError("auth.session_required");

    const traceId = extractTraceId(request.headers) ?? this.deps.newTraceId();
    const client = bindingFor(request);

    // Same key-prefix-hint reasoning as `handle()`: the hint selects which
    // prefix is searched, never which tenant is served — the record's own
    // `tenant` field (checked below) is the authority.
    const resolution: ResolveCitizenSessionResult = await runWithTenant(
      { tenant: cookie.tenantHint, principal: null, traceId },
      async () => this.deps.resolveCitizenSession!.execute({ sessionId: cookie.sessionId, client }),
    );

    if (resolution.kind !== "active") throw new UnauthenticatedError("auth.session_required");

    const { session } = resolution;
    if (session.tenant !== cookie.tenantHint) {
      throw new UnauthenticatedError("auth.session_required");
    }

    return runWithTenant({ tenant: session.tenant, principal: null, traceId }, async () =>
      handler({ session, traceId }),
    );
  }
}

/**
 * `X-Forwarded-For` is trusted only as far as the coarse binding, which is not an
 * authorization input — see `clientBindingOf`. The leftmost entry is taken
 * because that is the original client when the edge appends correctly, and a
 * spoofed value costs an attacker who already holds the cookie nothing.
 *
 * Exported (not just used internally) so the sign-in route (`next-request-
 * context.ts`'s `signInWithPassword`/`completeTotpChallengeFromCookie`) computes
 * the *identical* binding at credential-verification time that this module will
 * later check the session against — `tasks/lessons.md`'s "a live-proof script's
 * client binding must match on both sides" lesson, generalised from test scripts
 * to the real sign-in path itself: the safest way to guarantee both sides agree
 * is for them to share one function, not two independently-written copies of the
 * same header-reading logic.
 */
export function bindingFor(request: InboundRequest): ClientBinding {
  const forwarded = request.headers["x-forwarded-for"];
  const address = forwarded ? (forwarded.split(",")[0]?.trim() ?? null) : request.ipAddress;
  return clientBindingOf(request.headers["user-agent"] ?? null, address);
}
