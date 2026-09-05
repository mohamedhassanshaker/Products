import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getExamAuthoringService } from '@/server/exam-authoring';

/** `GET /api/exam-types/:id` — requires `exams.read`. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'exams.read');
    const { id } = await params;
    const result = await getExamAuthoringService().get(id);
    return NextResponse.json(result);
  });
}

/** `DELETE /api/exam-types/:id` — requires `exams.delete`. Success is `204` (no body). Ported from
 * `legacy/api/src/modules/exam-authoring/api/exam-authoring.controller.ts`'s `delete` — see
 * `ExamAuthoringService.delete`'s own doc comment for the `EXAM_TYPE_HAS_ACTIVE_ATTEMPTS` forward
 * reference (always unreachable this phase, no `attempts` module exists until Phase 7). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'exams.delete');
    const { id } = await params;
    await getExamAuthoringService().delete(id);
    return new NextResponse(null, { status: 204 });
  });
}
