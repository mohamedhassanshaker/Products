import { NextResponse } from 'next/server';
import type { HealthLivenessResponse } from '@examland/contracts';

/** Process start time, used to compute `uptimeSeconds` — module-level (not per-request), so it
 * reflects genuine process uptime across every request this Node process serves. */
const startedAt = Date.now();

/**
 * `GET /api/health` — liveness only (migration plan item 6, mirroring the legacy app's own
 * `/api/health` vs `/api/health/ready` split, LLD §7.10). Deliberately performs **no dependency
 * I/O** (no MySQL/Qdrant/storage calls) so an orchestrator's liveness probe never times out or flaps
 * because of a slow downstream — that is exactly what a future `/api/health/ready` (Phase 1+, once
 * there is something real to check) is for.
 *
 * Response shape is `HealthLivenessResponse` from `@examland/contracts`, the same shared-contract
 * type the legacy app's `HealthController.liveness()` returns — keeps the wire shape identical
 * across both stacks during the migration.
 */
export async function GET() {
  const body: HealthLivenessResponse = {
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
