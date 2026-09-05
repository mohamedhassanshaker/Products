import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { getDashboardService } from '@/server/dashboard';

/**
 * `GET /api/dashboard` (migration plan Phase 9 sub-slice "9c") — any authenticated tenant realm user may
 * call this route (no single `requirePermission` gate here, deliberately): `DashboardService.getSummary`
 * itself decides, section by section, which of curricula/exam-types/attempts/practice the acting user's
 * own permissions actually entitle them to see (see `DashboardSummary`'s own doc comment) — a blanket
 * route-level permission check would either over-restrict (denying a Member with only `attempts.take`
 * a dashboard at all) or under-restrict (requiring the lowest-common-denominator permission and then
 * silently omitting sections client-side, which `nexus-ux`'s own established pattern for this shell
 * treats as a nav-visibility decision, not a route-authorization one).
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    const summary = await getDashboardService().getSummary(principal.userId);
    return NextResponse.json(summary);
  });
}
