/**
 * The widget origin allow-list check (api.md §4.1) — the *real* security
 * boundary this surface relies on, not `channelKey` (see `channel-key.ts`'s
 * own doc comment). Every request under `/api/public/v1/*` except the health
 * check calls `assertOriginAllowed` after the tenant/channel is resolved.
 *
 * ## Exact host or single-label wildcard — never a bare suffix match
 *
 * api.md §4.1 names the attack directly: `evil-sharjah.ae` must not pass a
 * naive suffix check against an allowed `sharjah.ae`. A suffix match
 * (`origin.endsWith(allowed)`) is exactly the bug — `"evil-sharjah.ae"` ends
 * with `"sharjah.ae"` as a literal string, with no dot boundary enforced. So
 * matching here is host-equality or `*.` + one label, both anchored on a
 * `.`-boundary, never a raw string suffix.
 */

/** A domain entry as stored on `WidgetAllowedDomains.domain` — no scheme, no path (the real CHECK constraint's own rule, mirrored here so a malformed stored row fails closed rather than matching everything). */
const WILDCARD_PREFIX = "*.";

export class OriginNotAllowedError extends Error {
  readonly code = "widget.domain_not_allowed";
  readonly status = 403;

  constructor(readonly origin: string | null) {
    super(
      origin
        ? `Origin "${origin}" is not on this channel's allowed-domains list.`
        : "This endpoint requires an Origin header.",
    );
    this.name = "OriginNotAllowedError";
  }
}

/** Extract the hostname from a raw `Origin` header value (`"https://sharjah.ae"` → `"sharjah.ae"`). Returns null for anything unparseable — an unparseable Origin can never be "allowed". */
function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Does `hostname` satisfy one allow-list entry?
 *
 * - `"sharjah.ae"` (no wildcard prefix): exact match only.
 * - `"*.sharjah.ae"`: matches any **single label** prepended to `sharjah.ae`
 *   — `"services.sharjah.ae"` matches, `"a.b.sharjah.ae"` does not (a
 *   single-label wildcard, per api.md §4.1's own wording, not a
 *   multi-level one), and `"sharjah.ae"` itself does not match its own
 *   wildcard entry (the bare domain must be listed separately if the widget
 *   studio wants both — this function does not invent an implicit apex
 *   match a reviewer did not configure).
 *
 * Both branches anchor on a real `.` boundary, so `"evil-sharjah.ae"` can
 * never match an allowed `"sharjah.ae"` under either rule: it is not string-
 * equal to it, and it does not end in `".sharjah.ae"` (it ends in
 * `"-sharjah.ae"`, a hyphen, not a dot).
 */
function matchesEntry(hostname: string, entry: string): boolean {
  const normalizedEntry = entry.trim().toLowerCase();

  if (normalizedEntry.startsWith(WILDCARD_PREFIX)) {
    const base = normalizedEntry.slice(WILDCARD_PREFIX.length);
    if (base.length === 0) return false;
    if (hostname === base) return false; // the wildcard does not cover the apex itself
    if (!hostname.endsWith(`.${base}`)) return false;
    // Single label only: exactly one more label than `base`.
    const prefix = hostname.slice(0, hostname.length - base.length - 1);
    return prefix.length > 0 && !prefix.includes(".");
  }

  return hostname === normalizedEntry;
}

/**
 * Evidence that a request is genuinely first-party (this app talking to
 * itself), for the two real, live-browser-found shapes that would otherwise
 * be rejected: a same-origin `GET` (no `Origin` header at all — a real
 * Chromium browser only sends `Origin` cross-origin or on an unsafe method)
 * and a same-origin `POST` (a real `Origin` header, but naming *this app's
 * own* origin — `http://localhost:3000` during local dev — which is real and
 * present, just never on any tenant's third-party embed allow-list, because
 * it has no reason to be). Both were found the same way: the `/{locale}/widget`
 * SSR demo page's own bootstrap/open-conversation calls, driven by a real
 * Chromium browser, rejected outright before this existed — `curl`, which
 * always lets a caller set whatever headers it likes, could never have
 * surfaced either shape.
 */
export interface SameOriginEvidence {
  readonly refererHeader: string | null;
  /** This request's own origin, i.e. `new URL(request.url).origin` — never taken from a header a caller could forge. */
  readonly requestOrigin: string;
}

/**
 * True when this request is self-directed: its `Origin` header (if present)
 * names this exact request's own origin, or — absent that header entirely —
 * its `Referer` does. Never used to *widen* what a genuinely cross-origin
 * request may do (a third party can trivially forge its own `Referer`, but
 * gains nothing from it here, since `requestOrigin` is derived from the
 * request's own URL, not from anything the caller sent) — only to recognise
 * this app's own first-party pages talking to their own API, which need no
 * allow-list entry to talk to themselves.
 */
function isSelfDirected(originHeader: string | null, evidence: SameOriginEvidence): boolean {
  if (originHeader) return originHeader === evidence.requestOrigin;
  try {
    return new URL(evidence.refererHeader ?? "").origin === evidence.requestOrigin;
  } catch {
    return false;
  }
}

/**
 * Throws `OriginNotAllowedError` unless `originHeader` is present and its
 * hostname matches at least one entry in `allowedDomains` — **or** `sameOrigin`
 * proves the request is self-directed (see `SameOriginEvidence`'s doc comment).
 *
 * `allowedDomains` is the tenant/channel's real `WidgetAllowedDomain.domain`
 * rows — read by the caller from `getTenantDb()` before this is called, so
 * this function itself stays pure and DB-free (architecture.md §4).
 */
export function assertOriginAllowed(
  originHeader: string | null,
  allowedDomains: readonly string[],
  sameOrigin?: SameOriginEvidence,
): void {
  if (sameOrigin && isSelfDirected(originHeader, sameOrigin)) return;

  if (!originHeader) throw new OriginNotAllowedError(null);

  const hostname = hostnameOf(originHeader);
  if (!hostname) throw new OriginNotAllowedError(originHeader);

  const allowed = allowedDomains.some((entry) => matchesEntry(hostname, entry));
  if (!allowed) throw new OriginNotAllowedError(originHeader);
}

export function isOriginAllowed(
  originHeader: string | null,
  allowedDomains: readonly string[],
): boolean {
  try {
    assertOriginAllowed(originHeader, allowedDomains);
    return true;
  } catch {
    return false;
  }
}
