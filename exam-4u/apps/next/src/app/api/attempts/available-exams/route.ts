import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getAttemptsService } from '@/server/attempts';

/** `GET /api/attempts/available-exams` (FR-TAKE-1's discovery listing) — requires `attempts.take`. */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'attempts.take');
    const result = await getAttemptsService().listAvailableExams();
    return NextResponse.json(result);
  });
}
