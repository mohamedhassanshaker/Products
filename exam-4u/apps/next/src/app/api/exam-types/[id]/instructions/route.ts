import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getAttemptsService } from '@/server/attempts';

/** `GET /api/exam-types/:id/instructions` (LLD §7.8, FR-TAKE-1) — requires `attempts.take`. A
 * separate route file (not folded into `app/api/exam-types/[id]/route.ts`) because it belongs to
 * `server/attempts`'s own bounded context (exam-taking, not exam-authoring) even though it shares the
 * `exam-types` URL prefix — mirrors legacy's identical `ExamInstructionsController` split. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'attempts.take');
    const { id } = await params;
    const result = await getAttemptsService().getInstructions(id);
    return NextResponse.json(result);
  });
}
