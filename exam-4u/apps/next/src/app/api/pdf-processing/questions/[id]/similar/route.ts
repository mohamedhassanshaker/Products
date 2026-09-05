import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext, requireTenantId } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getSimilarQuestionsService } from '@/server/pdf-processing';

/** `GET /api/pdf-processing/questions/:id/similar` — tenant-realm, requires `pdf.review` (the reviewer
 * "Find similar questions" tool, migration plan Phase 6, sub-slice "6d"). Read-only; never gates or is
 * consulted by finalize — a purely advisory duplicate-spotting aid. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'pdf.review');
    const { id } = await params;
    const matches = await getSimilarQuestionsService().findSimilar(requireTenantId(), id);
    return NextResponse.json(matches);
  });
}
