import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getQuestionReviewService } from '@/server/pdf-processing';

/** `GET /api/pdf-processing/sessions/:id/questions?page=&pageSize=` — tenant-realm, requires
 * `pdf.review` (FR-PDF-8's paginated review list, migration plan Phase 6, sub-slice "6c"). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'pdf.review');
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page');
    const pageSize = searchParams.get('pageSize');
    const result = await getQuestionReviewService().listForSession(id, page ? Number(page) : undefined, pageSize ? Number(pageSize) : undefined);
    return NextResponse.json(result);
  });
}
