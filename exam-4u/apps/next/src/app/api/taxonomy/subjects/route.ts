import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getTaxonomyService } from '@/server/taxonomy';
import { requireInt, requireIntFromQuery, requireString } from '@/server/common/http/validate';

/** `GET /api/taxonomy/subjects?stageId=` — requires `taxonomy.read` — ported from
 * `legacy/api/src/modules/taxonomy/api/taxonomy.controller.ts`'s `listSubjects`. */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'taxonomy.read');
    const stageId = requireIntFromQuery(request.nextUrl.searchParams.get('stageId'), 'stageId');
    const rows = await getTaxonomyService().listSubjects(stageId);
    return NextResponse.json(rows);
  });
}

/** `POST /api/taxonomy/subjects` — requires `taxonomy.create`. FR-TAX-2's create-or-fetch, same
 * 200-vs-201 convention as `education-levels`/`stages`. */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'taxonomy.create');

    const body: unknown = await request.json().catch(() => ({}));
    const stageId = requireInt((body as { stageId?: unknown })?.stageId, 'stageId');
    const name = requireString((body as { name?: unknown })?.name, 'name', { min: 1, max: 500 });

    const { entity, created } = await getTaxonomyService().createOrFetchSubject(stageId, name);
    return NextResponse.json(entity, { status: created ? 201 : 200 });
  });
}
