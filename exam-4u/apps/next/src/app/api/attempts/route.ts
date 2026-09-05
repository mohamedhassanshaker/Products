import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantId, withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { requireFeatureLimit } from '@/server/platform/usage';
import { getAttemptsService } from '@/server/attempts';
import { parseJsonBody, requireString } from '@/server/common/http/validate';

/**
 * `POST /api/attempts` (FR-TAKE-2/FR-TAKE-3, LLD §7.8/§8.1) — requires `attempts.take`, then
 * `attempts.monthly`'s feature-usage limit (LLD §7.8/§8.1's `PermissionsGuard` **then**
 * `FeatureLimitGuard` order, matching legacy's `AttemptsController.start`) — closes the gap Phase 10's
 * own e2e validation pass flagged (see `docs/plans/nextjs-rewrite-phase10-plan.md`'s "Post-e2e
 * closure" section): no route in this app enforced any package feature limit until this dispatch
 * ported `server/platform/usage`.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'attempts.take');
    await requireFeatureLimit(requireTenantId(), 'attempts.monthly');
    const body = await parseJsonBody(request);
    const examTypeId = requireString(body.examTypeId, 'examTypeId', { min: 1, max: 36 });
    const result = await getAttemptsService().startAttempt(examTypeId);
    return NextResponse.json(result, { status: 201 });
  });
}

/** `GET /api/attempts` (FR-TAKE-9's own-history view) — requires `attempts.read_own`. Optional
 * `?examTypeId=` narrows to one Exam Type, matching legacy's `AttemptHistoryQueryDto`. */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'attempts.read_own');
    const examTypeId = request.nextUrl.searchParams.get('examTypeId') ?? undefined;
    const result = await getAttemptsService().listOwnHistory(examTypeId);
    return NextResponse.json(result);
  });
}
