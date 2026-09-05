import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getAttemptsService } from '@/server/attempts';

/** `GET /api/admin/attempts` (FR-TAKE-9's tenant-wide view) — requires `attempts.read_all`. A
 * separate route file (not a second branch on `app/api/attempts/route.ts`) purely for the distinct
 * `admin/` path prefix — same guard shape, same service, no ownership narrowing (a Tenant Admin with
 * `attempts.read_all` sees every Member's attempts by design), mirroring legacy's identical
 * `AdminAttemptsController` split. */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'attempts.read_all');
    const examTypeId = request.nextUrl.searchParams.get('examTypeId') ?? undefined;
    const userId = request.nextUrl.searchParams.get('userId') ?? undefined;
    const result = await getAttemptsService().listAllHistory({ examTypeId, userId });
    return NextResponse.json(result);
  });
}
