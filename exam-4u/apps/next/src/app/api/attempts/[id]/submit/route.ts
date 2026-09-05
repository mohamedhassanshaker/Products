import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getAttemptsService } from '@/server/attempts';

/** `POST /api/attempts/:id/submit` (FR-TAKE-6/FR-TAKE-7) — requires `attempts.take`. Success is `200`
 * (not `201` — no new resource is created, ported from legacy's `@HttpCode(HttpStatus.OK)` override). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'attempts.take');
    const { id } = await params;
    const result = await getAttemptsService().submit(id);
    return NextResponse.json(result, { status: 200 });
  });
}
