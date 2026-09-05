import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getPdfProcessingService } from '@/server/pdf-processing';

/** `GET /api/pdf-processing/sessions/:id` — tenant-realm, requires `pdf.review`; ownership (or
 * `exams.review`) is separately enforced inside `PdfProcessingService.getSession` (not a route-level
 * guard — matches `GET /exam-types/:id`'s identical "ownership is not a guard" convention). This is the
 * minimal status-poll contract this sub-slice's UI drives (Generating/Reviewing-ready/Failed states) —
 * the full paginated review-table response is sub-slice 6c's own scope. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'pdf.review');
    const { id } = await params;
    const result = await getPdfProcessingService().getSession(id);
    return NextResponse.json(result);
  });
}
