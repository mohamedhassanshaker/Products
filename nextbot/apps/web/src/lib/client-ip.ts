import "server-only";
import type { NextRequest } from "next/server";

/**
 * Best-effort caller IP for `apps/web`'s own anonymous, pre-auth endpoints (e.g.
 * `GET /api/v1/public/tenant-branding/{slug}`) — mirrors
 * `apps/gateway/src/lib/client-ip.ts` exactly (see its doc comment for the full
 * rationale: `NextRequest.ip` is a platform-specific extension never populated
 * under a self-hosted `next start`, so the standard reverse-proxy-forwarded
 * header is the practical, deployment-agnostic alternative). Duplicated rather
 * than imported for the same reason `apps/web/src/lib/rate-limit.ts` duplicates
 * `apps/gateway/src/lib/rate-limit.ts`: `apps/gateway`'s `src/lib/*` is app-private,
 * not a shared package, and this project has no dedicated `@nextbot/http-utils`
 * package yet.
 *
 * A request with neither header collapses every such caller onto one shared
 * bucket rather than skipping the limit entirely — deliberately fail-closed.
 */
export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
