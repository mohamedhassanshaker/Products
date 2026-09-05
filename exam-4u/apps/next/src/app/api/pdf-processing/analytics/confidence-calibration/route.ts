import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getConfidenceCalibrationService } from '@/server/pdf-processing';

/** `GET /api/pdf-processing/analytics/confidence-calibration` — tenant-realm, requires `pdf.review`
 * (the confidence-threshold recalibration analytics dashboard, migration plan Phase 6, sub-slice
 * "6d"). No params — a tenant-wide, read-only report. */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'pdf.review');
    const report = await getConfidenceCalibrationService().getReport();
    return NextResponse.json(report);
  });
}
