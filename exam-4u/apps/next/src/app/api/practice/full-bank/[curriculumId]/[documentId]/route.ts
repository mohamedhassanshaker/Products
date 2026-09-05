import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantId, withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { requireFeatureLimit } from '@/server/platform/usage';
import { getFullBankAssessmentService } from '@/server/practice';
import { parseJsonBody, optionalInt } from '@/server/common/http/validate';

/**
 * `POST /api/practice/full-bank/:curriculumId/:documentId` (FR-PDF-13) — requires `pdf.upload`,
 * ported verbatim from legacy's `PdfProcessingController.startFullBankAssessment` permission (the
 * feature is scoped under `practice` in this app per the migration plan's own phase-list wording, but
 * its RBAC grant is unchanged from legacy — starting a bank-generation run is the same class of
 * action as uploading a PDF for processing). Always `202` before any AI work — the same
 * fire-and-forget scheduling convention `PdfProcessingService.uploadPdf` established.
 *
 * **`pdf.generations` feature-usage limit** (FR-PKG-5): checked/incremented via `requireFeatureLimit`
 * immediately after the permission check, matching legacy's `@RequiresFeature('pdf.generations')`
 * guard order on `PdfProcessingController.startFullBankAssessment`. This route was missed by the
 * initial `platform/usage` closure pass (its folder was moved/renamed during Phase 8's own closure
 * verification, and the retrofit pass's grep for call sites didn't recognize it under its new path)
 * — found and fixed as a direct follow-up once the omission was noticed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ curriculumId: string; documentId: string }> },
): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'pdf.upload');
    await requireFeatureLimit(requireTenantId(), 'pdf.generations');
    const { curriculumId, documentId } = await params;
    const body = await parseJsonBody(request);
    const targetQuestionCount = optionalInt(body.targetQuestionCount, 'targetQuestionCount', { min: 1, max: 500 });
    const targetTotalMinutes = optionalInt(body.targetTotalMinutes, 'targetTotalMinutes', { min: 1, max: 600 });
    const result = await getFullBankAssessmentService().start(curriculumId, documentId, { targetQuestionCount, targetTotalMinutes });
    return NextResponse.json(result, { status: 202 });
  });
}
