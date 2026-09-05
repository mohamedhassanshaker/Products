/**
 * Best-effort client IP extraction for audit-log `ip` fields (HLD §5.3). No module-boundary ESLint
 * rule (matching `common/`'s established "shared-kernel, stateless, pure code" precedent — see
 * `domain-error.ts`'s doc comment) — this is a pure function over already-available request headers,
 * not a resource/singleton to protect.
 *
 * Next.js Route Handlers run behind whatever reverse proxy/load balancer fronts the deployment (this
 * app's own compose stack has no such proxy in front of `web` yet, but the header is still the
 * portable, framework-idiomatic source — the same one legacy's own `req.ip` implicitly trusted via
 * Express's `trust proxy` setting). Returns `null` (never throws) when no address can be determined —
 * an audit row's `ip` column is nullable specifically for this case.
 */
export function getRequestIp(request: Request): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // The header may carry a comma-separated chain (`client, proxy1, proxy2`) — the first entry is
    // the original client, per the de-facto `X-Forwarded-For` convention every reverse proxy follows.
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return null;
}
