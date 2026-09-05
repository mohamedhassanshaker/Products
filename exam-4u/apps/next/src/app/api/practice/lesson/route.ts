import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getLessonPracticeService } from '@/server/practice';
import { parseJsonBody, optionalString, requireInt } from '@/server/common/http/validate';

/**
 * `POST /api/practice/lesson` (FR-CUR-6) — requires `attempts.take`, the generic "can this principal
 * take a practice/exam session at all" grant every attempts route already uses, since Lesson Practice
 * is a member-facing practice feature, not a Curriculum-authoring one (matches legacy's
 * `PracticeController.lessonGenerate`). `422 EMPTY_QUESTION_BANK` when the resolved scope's packaged
 * bank is genuinely empty — see `LessonPracticeService.generate`'s own doc comment.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'attempts.take');
    const body = await parseJsonBody(request);
    const stageId = requireInt(body.stageId, 'stageId', { min: 1 });
    const subjectId = requireInt(body.subjectId, 'subjectId', { min: 1 });
    const documentId = optionalString(body.documentId, 'documentId', { min: 1, max: 36 });
    const curriculumId = optionalString(body.curriculumId, 'curriculumId', { min: 1, max: 36 });
    // Deliberately not bounds-checked here — see `POST /api/practice/prompt`'s identical rationale:
    // `LessonPracticeService.generate` itself throws the named `INVALID_QUESTION_COUNT` error.
    const count = requireInt(body.count, 'count');
    const result = await getLessonPracticeService().generate({ stageId, subjectId, documentId, curriculumId, count });
    return NextResponse.json(result, { status: 200 });
  });
}
