import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getAttemptsService } from '@/server/attempts';
import { requireIntFromQuery } from '@/server/common/http/validate';

/** `GET /api/attempts/:id/questions/:index` (FR-TAKE-4) — requires `attempts.take`. `index` is parsed
 * as a required non-negative integer path segment (`requireIntFromQuery` reused for a path param —
 * both are "a string that must parse to a bounded integer or fail loudly," the same validation shape). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> },
): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'attempts.take');
    const { id, index } = await params;
    const questionIndex = requireIntFromQuery(index, 'index', { min: 0 });
    const result = await getAttemptsService().getQuestion(id, questionIndex);
    return NextResponse.json(result);
  });
}
