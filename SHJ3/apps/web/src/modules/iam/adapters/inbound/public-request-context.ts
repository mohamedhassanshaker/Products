/**
 * The citizen-surface counterpart to `next-request-context.ts`.
 *
 * `withStaffAuth` exists because a Server Component/Action has no real
 * `Request` object — `buildInboundRequest()` there has to fabricate a
 * placeholder path and accept `ipAddress: null` because Next's own APIs don't
 * offer anything better in that position (see that file's module comment).
 * The public API (api.md §4) is different in exactly the way that matters
 * here: `app/api/public/v1/*` are real Next.js Route Handlers, each handed a
 * real `Request` — a real `Origin` header (the whole basis of the widget's
 * allowed-domains enforcement, api.md §4.1), a real pathname, and — through
 * the platform edge/proxy — a real forwarded client address. Building a
 * second, weaker `InboundRequest` here to match the Server Component path
 * would throw away information this surface actually has and actually needs.
 *
 * Reuses the *same* cached `AuthMiddleware` instance `next-request-context.ts`
 * builds (via its exported `authMiddleware()`), not a second composition
 * root — one `resolveSession`/`resolveCitizenSession` pair for the whole
 * process, so a change to either resolution path cannot silently diverge
 * between the staff and citizen surfaces.
 */

import { UnauthenticatedError } from "./auth-middleware.js";
import type { InboundRequest } from "./auth-middleware.js";
import { authMiddleware } from "./next-request-context.js";
import type { SessionRecord } from "../../domain/session.js";
import type { TenantSlug } from "../../../platform/tenancy/tenant-slug.js";

/**
 * Build an `InboundRequest` from a real Next.js `Request`/`NextRequest`.
 *
 * `body` is supplied separately (already-parsed JSON) rather than read here,
 * because a Route Handler can only consume its request body once — callers
 * that need the raw bytes before parsing (the WhatsApp webhook's HMAC check,
 * `modules/channels`) read them first and never call this at all for that
 * route, exactly as this function's absence from the webhook path documents.
 */
export function buildPublicInboundRequest(
  request: Request,
  options: { readonly query?: Record<string, unknown>; readonly body?: unknown } = {},
): InboundRequest {
  const url = new URL(request.url);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookies = parseCookieHeader(cookieHeader);

  const headerRecord: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headerRecord[key] = value;
  });

  return {
    method: request.method,
    path: url.pathname,
    cookies,
    headers: headerRecord,
    ...(options.query !== undefined ? { query: options.query } : {}),
    ...(options.body !== undefined ? { body: options.body } : {}),
    // `x-forwarded-for` (read by `bindingFor` inside `auth-middleware.ts`) is
    // the real signal on this path; a direct socket address is not available
    // to a Route Handler either, so `null` is the same honest fallback
    // `next-request-context.ts` documents for the Server Component path.
    ipAddress: null,
  };
}

function parseCookieHeader(header: string): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name.length > 0) result[name] = decodeURIComponent(value);
  }
  return result;
}

/**
 * The bootstrap/open-conversation entry points (api.md §4.2) — no session
 * exists yet, and the tenant comes from the caller-supplied `channelKey`
 * (resolved and validated by the caller *before* this is called; see
 * `modules/channels`' `resolveChannelKey`). This never becomes an
 * authorization input for anything beyond "which tenant's public config to
 * read" — the origin allow-list is the actual security control (api.md §4.1),
 * enforced by the caller as well, not by this wrapper.
 */
export async function withAnonymousChannel<T>(
  request: Request,
  channelTenant: TenantSlug,
  handler: (context: { readonly traceId: string }) => Promise<T>,
  options: { readonly query?: Record<string, unknown>; readonly body?: unknown } = {},
): Promise<T> {
  const inbound = buildPublicInboundRequest(request, options);
  return authMiddleware().handleAnonymous(inbound, channelTenant, handler);
}

/**
 * Every conversation-scoped citizen endpoint after the conversation is
 * opened (api.md §4.2's `citizen session` rows) — the tenant is re-derived
 * from the `shj3_cs` cookie's session record, never from a request field,
 * matching ADR-0002 rule 1 exactly as `withStaffAuth` does for staff.
 *
 * Throws `UnauthenticatedError` (`auth.session_required`) for no session, an
 * expired one or a binding mismatch — callers render/return the public API's
 * `401` for all three, uniformly, per api.md §4.1's "no enumeration" rule:
 * distinguishing them to the caller would be a signal an attacker could use
 * to fingerprint which failure mode a guessed cookie hit.
 */
export async function withCitizenSession<T>(
  request: Request,
  handler: (context: { readonly session: SessionRecord; readonly traceId: string }) => Promise<T>,
  options: { readonly query?: Record<string, unknown>; readonly body?: unknown } = {},
): Promise<T> {
  const inbound = buildPublicInboundRequest(request, options);
  return authMiddleware().handleCitizenSession(inbound, handler);
}

export { UnauthenticatedError };
