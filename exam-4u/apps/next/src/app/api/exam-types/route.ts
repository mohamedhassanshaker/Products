import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getExamAuthoringService } from '@/server/exam-authoring';

/** `GET /api/exam-types` — tenant-realm, requires `exams.read` — ported from
 * `legacy/api/src/modules/exam-authoring/api/exam-authoring.controller.ts`'s `list`. Returns the full,
 * unsorted-by-any-param set (no sort/filter/pagination params exist on this endpoint, matching legacy's
 * identical scope). */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'exams.read');
    const rows = await getExamAuthoringService().list();
    return NextResponse.json(rows);
  });
}
