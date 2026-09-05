import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getLessonPracticeService } from '@/server/practice';
import { parseJsonBody, requireInt, requireString } from '@/server/common/http/validate';

/** `POST /api/practice/sessions/:id/answer` (FR-CUR-6) — requires `attempts.take`; owner-only
 * enforcement happens inside `LessonPracticeService.answer`. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'attempts.take');
    const { id } = await params;
    const body = await parseJsonBody(request);
    const position = requireInt(body.position, 'position', { min: 0 });
    const selectedOption = requireString(body.selectedOption, 'selectedOption', { min: 1, max: 10 });
    const result = await getLessonPracticeService().answer(id, position, selectedOption);
    return NextResponse.json(result, { status: 200 });
  });
}
