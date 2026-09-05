import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { getAttemptsService } from '@/server/attempts';
import { requireEnum } from '@/server/common/http/validate';

/**
 * `GET /api/attempts/:id/review` (FR-TAKE-8) — **authentication-only, no `requirePermission` call**,
 * ported deliberately from legacy's `AttemptsController.review` (see that method's own doc comment):
 * a Tenant Admin who holds `attempts.read_all` but not `attempts.take` must still be able to exercise
 * the oversight half of this route, so gating it on `attempts.take` here would incorrectly lock them
 * out. `AttemptsService.review`'s own `assertOwnerOrOversight` is the real access-control chokepoint.
 * `?filter=all|wrong` defaults to `'all'`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    await requireTenantUser(request);
    const { id } = await params;
    const rawFilter = request.nextUrl.searchParams.get('filter') ?? 'all';
    const filter = requireEnum(rawFilter, 'filter', ['all', 'wrong'] as const);
    const result = await getAttemptsService().review(id, filter);
    return NextResponse.json(result);
  });
}
