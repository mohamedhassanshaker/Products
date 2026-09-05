/**
 * The "is this caller even allowed to see that the Platform Manager console exists?"
 * primitives (NFR-11) — the configured-check, the IPv4 CIDR allowlist matcher, and the
 * trusted-proxy `X-Forwarded-For` resolution.
 *
 * ## Why these live in their own module
 *
 * They used to sit in `platform-ops-auth.ts`, which still re-exports every one of them
 * unchanged (so no existing call site or test had to move). They were split out because
 * `middleware.ts` now needs them: the page-surface indistinguishability fix
 * (page-surface Defect 1 — see `middleware.ts`'s own doc comment) has to decide *before*
 * Next routes a request whether to rewrite it onto the console's real route path, and
 * Next's middleware runs in the Edge runtime, which
 * cannot load `platform-ops-auth.ts` at all — that module imports `node:crypto` (for
 * `verifyOperatorToken`'s constant-time digest comparison) and `server-only` (which
 * resolves to a module that throws outside a React Server Component graph).
 *
 * This module therefore holds **only** logic that is pure and runtime-agnostic: string
 * parsing, integer bitwise arithmetic, and `process.env` reads. No Node built-ins, no
 * `server-only`, no React, no I/O. Keep it that way — an import that breaks the Edge build
 * here stops middleware from compiling, and with it the *only* thing that routes an
 * operator onto the console at all. Note which way that fails: it takes the console
 * offline (every request 404s), it does not expose it. That is the deliberate consequence
 * of gating the allow path rather than the deny path — see `middleware.ts`.
 *
 * It contains no secret material and reads no credential: `isPlatformOpsConfigured()`
 * only tests two env vars for emptiness (never exposing their values), and nothing here
 * compares a token. Token verification deliberately stays in `platform-ops-auth.ts`.
 */

/**
 * True only when both `NEXTBOT_OPS_OPERATOR_TOKEN` and `NEXTBOT_OPS_IP_ALLOWLIST`
 * are set to a non-empty value. When false, every caller (`requirePlatformApi()`,
 * `middleware.ts`, and every `/internal/ops/**` page segment) must fail closed with the
 * shared not-found answer — the surface must not even confirm its own existence when it
 * hasn't been deliberately turned on for this deployment.
 */
export function isPlatformOpsConfigured(): boolean {
  return Boolean(process.env.NEXTBOT_OPS_OPERATOR_TOKEN) && Boolean(process.env.NEXTBOT_OPS_IP_ALLOWLIST);
}

/** Parses a dotted-quad IPv4 address into its 32-bit unsigned integer form, or
 * `null` if `raw` isn't a syntactically valid IPv4 address. IPv4 only — matches the
 * plan's explicit scope (a hand-written IPv6 CIDR matcher is materially more complex
 * and not required by this feature; flagged here rather than silently pretended to
 * be handled). */
function parseIpv4(raw: string): number | null {
  const parts = raw.trim().split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

/**
 * Hand-rolled IPv4 CIDR/exact-IP allowlist matcher (deliberately no dependency —
 * the plan calls this out explicitly as small enough to not warrant one). Each
 * comma-separated entry in `allowlistCsv` is either a bare IP (`"203.0.113.5"`,
 * treated as a `/32`) or a CIDR block (`"10.0.0.0/24"`). Malformed entries are
 * skipped individually rather than failing the whole check (one operator typo in a
 * long allowlist shouldn't lock every other configured range out too) — but see
 * `isPlatformOpsConfigured()`: an *entirely* missing/empty allowlist still fails
 * closed at the caller.
 */
export function isIpAllowed(ip: string, allowlistCsv: string): boolean {
  const ipNum = parseIpv4(ip);
  if (ipNum === null) return false;

  const entries = allowlistCsv
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const [addrPart, prefixPart] = entry.split("/");
    const addrNum = addrPart === undefined ? null : parseIpv4(addrPart);
    if (addrNum === null) continue;

    const prefix = prefixPart === undefined ? 32 : Number(prefixPart);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) continue;

    // `<<` in JS treats its shift amount mod 32, so `0xFFFFFFFF << 32` is a no-op
    // (NOT zero) rather than the "match everything" mask a /0 entry needs — handled
    // as an explicit special case rather than relying on the bitwise identity.
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if ((ipNum & mask) === (addrNum & mask)) return true;
  }
  return false;
}

/**
 * The immediate reverse-proxy hop(s), if any, this deployment guarantees sit in
 * front of `apps/web` and can be trusted to have set/overwritten
 * `X-Forwarded-For`/`X-Real-IP` themselves rather than passing through whatever a
 * caller supplied. Comma-separated IPs/CIDRs, reusing `isIpAllowed`'s own parser.
 *
 * QA retry 1, Defect 2: **this is deliberately unset by default.** The project's
 * actual, currently-deployed topology (`docker-compose.yml`'s `web` service, see
 * `docs/deployment/DEPLOYMENT.md`) publishes `apps/web`'s port directly — there is
 * *nothing* between a caller and this app today that could legitimately have set
 * either header, so trusting them unconditionally (the previous behavior) handed a
 * caller full control over the IP-allowlist check: QA proved a disallowed real
 * connection got past `NEXTBOT_OPS_IP_ALLOWLIST` by simply sending
 * `X-Forwarded-For: <an-allowed-ip>` directly. Next.js's App Router gives Route
 * Handlers/Server Actions no access to the raw TCP peer address in any run mode
 * short of a bespoke custom server (`NextRequest`/`next/headers` are built on the
 * Fetch API, not Node's `http.IncomingMessage`; `NextRequest.ip` was a
 * Vercel-platform-only extension that has never populated under a self-hosted
 * `next start`) — so this module cannot itself verify "did the immediate connection
 * really come from a trusted proxy" the way, say, an Express app with access to
 * `req.socket.remoteAddress` could. Given that, and given no such proxy is
 * guaranteed in front of this app in any deployment this project currently
 * supports, the safer default is to not trust these headers *at all* rather than
 * silently keep trusting spoofable client input — see `extractClientIp` below.
 *
 * Operators who *do* front this app with a reverse proxy that overwrites (never
 * appends to) `X-Forwarded-For`/`X-Real-IP` from its own observed connection, and
 * whose network topology (firewall/security-group/container network policy)
 * guarantees the app is unreachable except through that proxy, may set this to the
 * proxy's own IP/CIDR to re-enable trusting the header — see the peeling logic in
 * `extractClientIp`. **This is a real residual trust assumption, not a fully
 * verified one**: this module still cannot independently confirm the direct
 * connection came from that proxy (no socket access, as above); the guarantee has
 * to come from the network layer. Flagged explicitly in
 * `docs/deployment/DEPLOYMENT.md` as a required follow-up for any deployment that
 * wants the IP-allowlist enforced against a real external network, rather than
 * decided unilaterally here.
 */
function getTrustedProxyCidrs(): string {
  return process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS ?? "";
}

/** Best-effort caller IP from a `Headers`-like object — accepts a real
 * `Request`/`NextRequest`'s `.headers`, `next/headers`'s `headers()` result, and the
 * `NextRequest.headers` middleware sees (all implement the same
 * `get(name): string | null` shape), so the exact same extraction logic serves the
 * route-handler guard, the page-segment gate, and the middleware gate.
 *
 * Unlike `client-ip.ts` (this app's public, pre-auth, lower-stakes rate-limiting
 * helper, which mirrors `apps/gateway`'s identical convention and is intentionally
 * left untouched by this fix), this is a genuine security boundary — the
 * Platform Manager console's whole "two independent checks" design intent (token +
 * IP) collapses to "token only" if this can be spoofed. See `getTrustedProxyCidrs`'s
 * doc comment for the full trust-model rationale.
 */
export function extractClientIp(headers: { get(name: string): string | null }): string {
  const trustedProxyCidrs = getTrustedProxyCidrs();
  // No reverse proxy is configured as trusted for this deployment (today's actual
  // default — see getTrustedProxyCidrs) — never honor a client-suppliable header;
  // there is nothing to peel and no way to tell a real proxy's value apart from an
  // attacker's, so the caller IP is treated as unresolvable (fails the allowlist
  // check unconditionally, rather than fail open on a header we can't trust at all).
  if (!trustedProxyCidrs.trim()) return "unknown";

  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    // Standard "trusted proxy" X-Forwarded-For parsing: each hop appends its own
    // observed remote address to the *right* of the chain, so the entries nearest
    // the right end are the ones a trusted proxy could plausibly have added
    // itself. Peel entries off from the right for as long as they match a
    // configured trusted-proxy CIDR; the first entry (moving leftward) that does
    // NOT match is the resolved caller IP. Never take the naive leftmost entry —
    // that position is entirely client-supplied in a multi-hop chain and was
    // exactly how QA's spoofed-header bypass worked against the old code.
    const hops = forwardedFor
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      if (!isIpAllowed(hops[i] as string, trustedProxyCidrs)) return hops[i] as string;
    }
    // Every hop matched a trusted-proxy CIDR — no client-supplied hop is present
    // at all (e.g. a misconfiguration, or a proxy-to-proxy health check). Fail
    // closed rather than guessing which trusted hop to treat as "the caller".
    return "unknown";
  }
  const realIp = headers.get("x-real-ip");
  // `X-Real-IP` is a single value (no chain to peel) — only meaningful when a
  // trusted proxy is what set it, which the (non-empty) trustedProxyCidrs check
  // above already established for this deployment.
  if (realIp) return realIp.trim();
  return "unknown";
}

/** Combines the configured-check + IP-allowlist-check every `/internal/ops/**`
 * entry point (middleware, API routes and page segments alike) must apply
 * unconditionally, regardless of which of the two token-carrying mechanisms (header
 * vs. cookie) is used. Returns `true` only when both checks pass. */
export function isRequestFromAllowedNetwork(headers: { get(name: string): string | null }): boolean {
  if (!isPlatformOpsConfigured()) return false;
  const ip = extractClientIp(headers);
  return isIpAllowed(ip, process.env.NEXTBOT_OPS_IP_ALLOWLIST as string);
}
