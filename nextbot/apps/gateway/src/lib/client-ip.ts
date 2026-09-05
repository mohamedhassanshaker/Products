import type { NextRequest } from "next/server";

/**
 * Best-effort caller IP for the widget's anonymous, pre-auth `POST /sessions`
 * endpoint's per-IP rate limit (BE2). `NextRequest` doesn't expose a reliable
 * `.ip` in every deployment target (Next.js's own `request.ip` is a
 * platform-specific extension populated by some hosts, e.g. Vercel, but never
 * populated for a self-hosted `next start` — the only mode this codebase's own
 * `apps/gateway/package.json` `start` script actually runs) — the standard
 * reverse-proxy-forwarded header is the practical, deployment-agnostic
 * alternative.
 *
 * A request with neither header collapses every such caller onto one shared
 * bucket rather than skipping the limit entirely — a deliberately fail-closed
 * posture: an unidentifiable caller is still capped (coarsely, alongside every
 * other unidentifiable caller), never silently exempted from the ceiling this
 * function exists to key.
 */
export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // The header can carry a client-proxy-proxy chain (`client, proxy1, proxy2`)
    // — the first entry is the original caller nexus-deploy's own reverse proxy
    // records.
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
