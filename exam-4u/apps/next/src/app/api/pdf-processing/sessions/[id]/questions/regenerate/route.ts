import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getQuestionReviewService } from '@/server/pdf-processing';
import { parseJsonBody } from '@/server/common/http/validate';
import { requireStringIdArray } from '@/server/common/http/id-array';

/** `POST /api/pdf-processing/sessions/:id/questions/regenerate` — tenant-realm, requires `pdf.review`
 * (FR-PDF-8: "`{ids[]}`; empty -> 200 no-op; preserves count" — see `QuestionReviewService.bulkRegenerate`'s
 * own doc comment for the exact "best-effort count preservation" algorithm). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'pdf.review');
    const { id } = await params;
    const body = await parseJsonBody(request);
    const ids = requireStringIdArray(body.ids, 'ids');
    const result = await getQuestionReviewService().bulkRegenerate(id, ids);
    return NextResponse.json(result);
  });
}
