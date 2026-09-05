import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getLessonPracticeService } from '@/server/practice';

/** `GET /api/practice/sessions/:id` (FR-CUR-6) — requires `attempts.take`; owner-only enforcement
 * happens inside `LessonPracticeService.getSession` (HLD §5.2 — "ownership is not a guard"), not here. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'attempts.take');
    const { id } = await params;
    const result = await getLessonPracticeService().getSession(id);
    return NextResponse.json(result);
  });
}
