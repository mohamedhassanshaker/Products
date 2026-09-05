import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getReliabilityDashboardSnapshot } from '@/server/platform/reliability';

/**
 * `GET /api/platform/reliability` — platform-realm, authenticated. New this dispatch (migration plan
 * Phase 2 sub-slice "2d") — no legacy HTTP precedent (legacy never built an admin-facing reliability
 * viewer). Read-only: aggregates outbox health (pending/delivered/dead-letter counts) and
 * file-cleanup-queue health across every `Active` tenant's own schema, plus the platform-schema
 * work-hint counts (honestly `0` for every kind today — no producer is wired yet, see
 * `server/platform/reliability`'s own doc comment). The real aggregation logic lives in
 * `getReliabilityDashboardSnapshot` (a module function, not this route) — this handler is a thin
 * orchestration shim, matching every other Route Handler in this app.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withPlatformAuth(request, async () => {
    const snapshot = await getReliabilityDashboardSnapshot();
    return NextResponse.json(snapshot);
  });
}
