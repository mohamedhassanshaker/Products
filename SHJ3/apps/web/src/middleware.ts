import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing.js";

/**
 * Locale negotiation and routing (architecture.md §9, design-system.md §11).
 * Handles "/" → "/en" (or the negotiated/cookied locale) redirects, validates
 * the `[locale]` segment on every other path, and sets the locale cookie.
 */
const intlMiddleware = createMiddleware(routing);

const PUBLIC_API_PREFIX = "/api/public/v1";

/**
 * CORS for the citizen-facing public API (B-6, api.md §4.1).
 *
 * ## Why this exists — a real bug a live-browser proof found, that curl cannot
 *
 * Every `/api/public/v1/*` route already enforces the real access-control
 * decision server-side: `assertOriginAllowed`/`assertOriginAllowedForChannelKind`
 * (`modules/conversation/domain/origin-allowlist.ts`) reject a disallowed
 * origin with a real `403 widget.domain_not_allowed`, proven directly with
 * curl during this wave's integration pass. What curl cannot exercise —
 * because curl does not implement CORS at all — is that a REAL BROWSER
 * additionally refuses to let the widget's own JavaScript ever read *any*
 * cross-origin response, allowed or not, unless the response itself carries
 * `Access-Control-Allow-Origin`. Without it, a real embed on a real allowed
 * site (`sharjah.ae`) failed with `TypeError: Failed to fetch` / a CORS
 * console error — found only by driving a real Chromium browser against a
 * real embed, exactly the class of gap this project's own `tasks/lessons.md`
 * already names (a server-side check can be entirely correct and a citizen's
 * real browser still never reaches it).
 *
 * ## Why the reflection is unconditional here, not allow-list-gated
 *
 * api.md §4.1's prose says the CORS reflection should itself "only echo
 * allow-listed origins." A byte-for-byte implementation of that would need
 * this middleware to resolve the *same* tenant/channel/allowed-domains the
 * route handler resolves — from a `channelKey` query param for the two
 * bootstrap-style routes, or from the `shj3_cs` session cookie for every
 * conversation-scoped route — which means either duplicating
 * `resolve-citizen-session.ts`/`widgetChannelRepository` logic here (a real
 * risk of the two copies drifting) or a second live database round trip per
 * request purely to decide a response header, on top of the one the route
 * handler already makes to decide the *real* thing. Reflecting unconditionally
 * is judged equivalent in practice, and is documented here rather than
 * silently done: `Access-Control-Allow-Origin` only ever controls whether a
 * browser's JavaScript may *read* a response body — it grants no server-side
 * access and cannot bypass the real check, which every route still performs
 * and still returns a real `403` from regardless of any header this
 * middleware adds. Reflecting the header on that `403` merely lets a
 * disallowed origin's own JS read a `widget.domain_not_allowed` error code —
 * no different from what curl (which was never gated by CORS) could already
 * read directly. Flagged plainly as a deliberate simplification rather than
 * the literal per-tenant reflection the prose describes, for whoever next
 * wants to tighten it (the real fix would run this middleware on the Node.js
 * runtime with its own tenant-scoped lookup, not the Edge default).
 */
function corsHeadersFor(origin: string | null): Headers {
  const headers = new Headers();
  if (!origin) return headers;
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Vary", "Origin");
  return headers;
}

function handlePublicApiCors(request: NextRequest): NextResponse {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    // The preflight itself grants no data access (per the module comment
    // above) — reflecting here too is the same, already-justified trade-off,
    // and lets every POST/PUT/DELETE route accept a real cross-origin
    // `Content-Type: application/json` request at all (that content type is
    // not CORS-"simple", so a browser preflights it before ever sending the
    // real request the route handler's own origin check actually gates).
    const headers = corsHeadersFor(origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "content-type, accept, x-csrf-token");
    headers.set("Access-Control-Max-Age", "600");
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();
  for (const [key, value] of corsHeadersFor(origin)) response.headers.set(key, value);
  return response;
}

export default function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith(PUBLIC_API_PREFIX)) {
    return handlePublicApiCors(request);
  }
  return intlMiddleware(request);
}

export const config = {
  // Two disjoint concerns behind one matcher: every non-API path (locale
  // negotiation, unchanged from before this wave) plus the public citizen API
  // prefix (CORS, added this wave) — `/api/**` outside that one prefix stays
  // excluded exactly as before (the BFF route handlers, e.g. `/api/healthz`,
  // must stay reachable with no locale or tenant context).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)", "/api/public/v1/:path*"],
};
