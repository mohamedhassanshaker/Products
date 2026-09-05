import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getQuestionReviewService } from '@/server/pdf-processing';
import { parseJsonBody } from '@/server/common/http/validate';
import { requireStringIdArray } from '@/server/common/http/id-array';

/** `POST /api/pdf-processing/sessions/:id/questions/bulk-delete` — tenant-realm, requires `pdf.review`
 * (FR-PDF-8: "accept a list of question ids and are no-ops (200, not errors) on an empty list"). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'pdf.review');
    const { id } = await params;
    const body = await parseJsonBody(request);
    const ids = requireStringIdArray(body.ids, 'ids');
    const result = await getQuestionReviewService().bulkDelete(id, ids);
    return NextResponse.json(result);
  });
}
