import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantId, withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getCurriculumDocumentsService } from '@/server/curricula';
import { requireInt } from '@/server/common/http/validate';

/** FR-CUR-3's bounded result count — a caller-supplied `limit` outside `[1, 50]` is a validation
 * failure, never silently clamped, matching this app's established `requireInt` bounds convention. */
const MAX_SEARCH_LIMIT = 50;

/**
 * `GET /api/curricula/:id/search?query=…&limit=…` — tenant-realm, requires `curricula.manage_own` —
 * FR-CUR-3's semantic search over one Curriculum's indexed chunks, each hit citing its originating
 * document and page (migration plan Phase 6, sub-slice "6b"). Ported from
 * `legacy/api/src/modules/curricula/api/curricula.controller.ts`'s `search`.
 *
 * A `GET` with query params (not a `POST` body): this is a pure read with no side effect beyond one
 * embedding call, and query strings keep it linkable/cacheable-by-default the way legacy's own
 * `SearchCurriculumDto`-on-query shape already established.
 *
 * **An absent/empty `query` returns `200 []`** — never a 400, never an arbitrary "browse everything"
 * listing (FR-CUR-3's own explicit rule), and no embedding call is made for it. Ownership/oversight is
 * enforced inside the service (HLD §5.2), so a non-owner without `curricula.read_all` gets
 * `403 NOT_CURRICULUM_OWNER` rather than an empty list that would leak nothing but also mislead.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'curricula.manage_own');
    const { id } = await params;

    const url = new URL(request.url);
    const query = url.searchParams.get('query') ?? '';
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit === null ? undefined : requireInt(Number(rawLimit), 'limit', { min: 1, max: MAX_SEARCH_LIMIT });

    const results = await getCurriculumDocumentsService().search(principal.userId, requireTenantId(), id, { query, limit });
    return NextResponse.json(results);
  });
}
