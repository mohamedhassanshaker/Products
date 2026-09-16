import { NextResponse } from "next/server";

/**
 * Liveness probe. "The process is up," nothing more.
 *
 * Deliberately does not touch SQL Server, Redis, or the AI service: a
 * liveness probe that depends on a downstream store causes Kubernetes to
 * restart a perfectly healthy pod during a database blip, which trades a
 * recoverable slowdown for an unrecoverable restart storm. Dependency health
 * belongs to a separate readiness probe and to B14 tab 3's observability
 * surface (deployment.md §13), not to this endpoint.
 *
 * No tenant context is bound here — this route is intentionally reachable
 * with no session and no tenant, which is why it lives outside the
 * `(assistant)`/`(backoffice)` route groups.
 */
export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" });
}
