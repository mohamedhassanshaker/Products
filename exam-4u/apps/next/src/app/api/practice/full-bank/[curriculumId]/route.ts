import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getFullBankAssessmentService } from '@/server/practice';

/** `GET /api/practice/full-bank/:id` (FR-PDF-13's poll contract) — requires `pdf.review`, ported
 * verbatim from legacy's `PdfProcessingController.getFullBankAssessmentSummary` permission.
 *
 * **Fixed during Phase 8 closure verification**: this route was previously nested at its own
 * `full-bank/[id]/route.ts` folder, sibling to `full-bank/[curriculumId]/[documentId]/route.ts` — two
 * different dynamic-segment names (`id` vs `curriculumId`) at the identical URL position, which Next.js
 * rejects outright (`Error: You cannot use different slug names for the same dynamic path`), crashing
 * the server on boot. Moved into the SAME `[curriculumId]` folder the POST route already owns (a
 * `route.ts` directly inside a dynamic folder, sibling to that folder's own nested dynamic child, is a
 * normal, supported Next.js App Router shape) — the externally-visible URL (`GET
 * /api/practice/full-bank/:id`) and behavior are unchanged; only the internal path-param name was
 * renamed from `id` to `curriculumId` to satisfy Next.js's single-name-per-segment constraint. The
 * session id this route reads is still just whatever value occupies that URL segment. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ curriculumId: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'pdf.review');
    const { curriculumId: sessionId } = await params;
    const result = await getFullBankAssessmentService().getSummary(sessionId);
    return NextResponse.json(result);
  });
}
