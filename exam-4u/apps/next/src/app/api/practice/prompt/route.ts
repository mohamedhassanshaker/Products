import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getPromptPracticeService } from '@/server/practice';
import { parseJsonBody, requireInt, requireString } from '@/server/common/http/validate';

/**
 * `POST /api/practice/prompt` (FR-CUR-5) — requires `curricula.manage_own`, ported verbatim from
 * legacy's identical class-level-decorator-turned-method-level choice (`PracticeController`'s own doc
 * comment): Prompt Practice is generated against a Curriculum the caller manages, so it reuses the
 * Curriculum-management grant rather than a new permission. Always `200` — a zero-usable-questions
 * outcome is a `{status: 'failed', message}` response body, never a 4xx/5xx.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'curricula.manage_own');
    const body = await parseJsonBody(request);
    const curriculumId = requireString(body.curriculumId, 'curriculumId', { min: 1, max: 36 });
    const prompt = requireString(body.prompt, 'prompt', { min: 0, max: 2000 });
    // Deliberately not bounds-checked here (unlike most numeric fields in this app) — `count`'s
    // [1,30] range is enforced by `PromptPracticeService.generate` itself, which throws the named
    // `INVALID_QUESTION_COUNT` error (FR-CUR-5's own exit gate: three distinct, named errors, not one
    // generic `VALIDATION_FAILED`). Only the shape (a real integer) is validated at this boundary.
    const count = requireInt(body.count, 'count');
    const result = await getPromptPracticeService().generate({ curriculumId, prompt, count });
    return NextResponse.json(result, { status: 200 });
  });
}
