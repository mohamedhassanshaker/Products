import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getAttemptsService } from '@/server/attempts';
import { parseJsonBody, requireIntFromQuery, requireString } from '@/server/common/http/validate';

/** `POST /api/attempts/:id/questions/:index/answer` (FR-TAKE-5) — requires `attempts.take`. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> },
): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'attempts.take');
    const { id, index } = await params;
    const questionIndex = requireIntFromQuery(index, 'index', { min: 0 });
    const body = await parseJsonBody(request);
    const selectedOption = requireString(body.selectedOption, 'selectedOption', { min: 1, max: 10 });
    const result = await getAttemptsService().answer(id, questionIndex, selectedOption);
    return NextResponse.json(result);
  });
}
