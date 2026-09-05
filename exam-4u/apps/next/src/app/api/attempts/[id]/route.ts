import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getAttemptsService } from '@/server/attempts';

/** `GET /api/attempts/:id` (the attempt header/countdown-anchor) — requires `attempts.take`. Ownership
 * is enforced inside `AttemptsService.getHeader`, not here (HLD §5.2 — "ownership is not a guard"). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'attempts.take');
    const { id } = await params;
    const result = await getAttemptsService().getHeader(id);
    return NextResponse.json(result);
  });
}
