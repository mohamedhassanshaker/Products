import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveTenantForRequest } from '@/server/tenancy';
import { TenantNotFoundError } from '@/server/platform/tenants';
import { toErrorResponse } from '@/server/common/http/error-envelope';

/**
 * Multi-tenancy entry point (migration plan: "`middleware.ts` (Node runtime, not Edge) derives the
 * tenant slug from `Host` and does the cached lookup exactly as `TenantResolutionMiddleware` does
 * today, then passes `x-tenant-id`/`x-tenant-slug`/`x-tenant-schema` as trusted headers"). Runs on
 * **every** matched request (page routes and API routes alike — legacy's own
 * `TenantResolutionMiddleware` is bound the same way, `forRoutes('/{*path}')` minus exclusions,
 * since a tenant's page shell needs the same resolved tenant a Route Handler does).
 *
 * `runtime: 'nodejs'` (not the Edge runtime, Next's middleware default) is load-bearing: tenant
 * resolution needs a real MySQL round-trip via TypeORM/`mysql2`, which requires Node's full runtime
 * (`node:net`/`node:tls`) — none of that is available on Edge.
 *
 * Deliberately does **not** acquire a pooled tenant `DataSource` here (unlike legacy's identical
 * middleware, which acquires-then-releases-on-`res.finish`/`close` around the whole request) — this
 * app's `withTenantContext` (in `server/context`) does that instead, once per Route Handler
 * invocation, because Next.js doesn't guarantee an ALS continuation (or a reliable "response
 * finished" event to release on) across the middleware→handler boundary the way Nest's Express chain
 * does. `middleware.ts`'s only job is: resolve the tenant, and hand its identity forward as trusted
 * headers.
 *
 * On any rejection (reserved/nonexistent slug, suspended, unavailable), the response is written
 * directly here and `next()`/`NextResponse.next()` is never called — mirrors legacy's own documented
 * fix (`ErrorResponseWriter`'s header comment): letting an error propagate past this layer risks a
 * later-registered handler silently replacing it.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get('x-request-id') ?? randomUUID();

  try {
    const tenant = await resolveTenantForRequest(request.headers.get('host'));

    // `NextResponse.next({ request: { headers } })` is how a Next.js middleware mutates the headers
    // seen by the eventual Route Handler/Server Component — the trusted `x-tenant-*` headers below are
    // never present on the *inbound* request (a client could otherwise forge them); this is the one
    // and only place they're ever set.
    const headers = new Headers(request.headers);
    headers.set('x-tenant-id', tenant.id);
    headers.set('x-tenant-slug', tenant.subdomainSlug);
    headers.set('x-tenant-schema', tenant.schemaName);
    headers.set('x-request-id', requestId);

    return NextResponse.next({ request: { headers } });
  } catch (err) {
    // A real top-level page navigation (not an API/XHR call — `sec-fetch-dest: document` is the
    // reliable modern-browser signal for that) that fails tenant resolution with `TENANT_NOT_FOUND`
    // gets a friendly redirect to `/start` (the tenant-picker entry page) instead of a raw JSON error
    // envelope — someone browsing the bare apex/reserved host (e.g. `localhost`) has no way to know
    // their own tenant's subdomain otherwise. Every other case (API calls, suspended/unavailable
    // tenants, `/start` itself) still gets the identical JSON envelope as before — this is additive,
    // not a change to the actual tenant-resolution contract.
    if (
      err instanceof TenantNotFoundError &&
      request.headers.get('sec-fetch-dest') === 'document' &&
      request.nextUrl.pathname !== '/start'
    ) {
      const url = request.nextUrl.clone();
      url.pathname = '/start';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return toErrorResponse(err, requestId, `${request.method} ${request.nextUrl.pathname}`);
  }
}

/**
 * `matcher` excludes exactly the routes legacy's own `TenantResolutionMiddleware` excludes
 * (`app.module.ts`: `.exclude('/health', '/health/{*path}', '/platform/{*path}', '/billing/webhook')`,
 * translated 1:1 to this app's real `/api/**` paths — this app has no NestJS global `api` prefix
 * quirk to trip over, unlike the double-prepending bug legacy's own comment documents):
 * - `/api/health` — liveness probe must never depend on tenant resolution / a DB round-trip.
 * - `/api/platform/**` — the platform-admin realm is never tenant-scoped (`platform_admin` lives
 *   only in the platform schema; a Platform Admin's `Host` header is irrelevant).
 * - `/api/billing/webhook` — a Stripe webhook has no `Host`-header tenant concept either (not built
 *   until Phase 2, excluded here so it never breaks once it lands).
 * - `/platform/**` (Phase 2, sub-slice "2a" addition) — the platform-console **UI** half of the same
 *   never-tenant-scoped realm `/api/platform/**` already excludes. Legacy's own equivalent middleware
 *   exclusion (`'/platform/{*path}'`, quoted above) already covered this — legacy's Angular SPA and
 *   NestJS API shared one origin/router, so that one exclusion covered both the platform UI routes and
 *   their API calls simultaneously. This app's Next.js router doesn't have that shared-prefix
 *   coincidence: `/platform/tenants` (a page) and `/api/platform/tenants` (its Route Handler) are two
 *   textually distinct paths, so each needs its own explicit exclusion. Without this, a real browser
 *   navigating to `/platform/login` would hit `resolveTenantForRequest()` against whatever `Host`
 *   header served the request — and since `admin`/`www`/etc. are `RESERVED_SUBDOMAINS` (`isReservedSlug`
 *   throws `TenantNotFoundError` for all of them, `server/tenancy/tenant-resolution.ts`), the platform
 *   console would 404 before ever reaching its own page component, for a Host that has nothing to do
 *   with any tenant. See `docs/plans/nextjs-rewrite-phase2-plan.md`'s "Decisions made" for the full
 *   URL-convention reasoning (real `/platform` path segment, not a bare Next.js route group, chosen
 *   specifically so this exclusion could exist at all).
 * - Next.js static asset internals (`_next/static`, `_next/image`, `favicon.ico`) — never
 *   tenant-scoped, and running a DB round-trip on every asset request would be pure waste.
 * - `/start` — the tenant-picker entry page (added post-migration, per direct user feedback: browsing
 *   the bare apex/reserved host previously surfaced a raw `TENANT_NOT_FOUND` JSON envelope instead of
 *   any usable page). Deliberately tenant-independent — its whole job is letting a user who doesn't
 *   know their own subdomain find it.
 *
 * `runtime: 'nodejs'` opts this middleware out of the Edge runtime (verified against this app's
 * pinned `next@15.5.23`: a real `next build` with this exact `config` shape emits
 * `.next/server/functions-config-manifest.json` with `"runtime": "nodejs"` for `/_middleware`, and a
 * compiled `.next/server/middleware.js` — confirmed by actually building, not assumed from docs).
 */
export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!api/health|api/platform|api/billing/webhook|platform|start|_next/static|_next/image|favicon.ico).*)'],
};
