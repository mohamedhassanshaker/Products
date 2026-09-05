import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getQuestionReviewService } from '@/server/pdf-processing';

/** `POST /api/pdf-processing/questions/:id/flag` — tenant-realm, requires `pdf.review`. `204` (no
 * body), matching legacy's identical `HttpStatus.NO_CONTENT` for this action. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'pdf.review');
    const { id } = await params;
    await getQuestionReviewService().flagQuestion(id);
    return new NextResponse(null, { status: 204 });
  });
}
