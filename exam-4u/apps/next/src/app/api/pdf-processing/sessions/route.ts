import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getPdfProcessingService } from '@/server/pdf-processing';

/** `GET /api/pdf-processing/sessions` — tenant-realm, requires `pdf.review`. Returns the full,
 * tenant-wide, unsorted-by-any-param set (no filter/pagination params exist on this route this
 * sub-slice, matching `GET /api/exam-types`'s identical established scope) — see
 * `PdfProcessingService.list`'s own doc comment for why this is not narrowed to "my own uploads". */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'pdf.review');
    const rows = await getPdfProcessingService().list();
    return NextResponse.json(rows);
  });
}
