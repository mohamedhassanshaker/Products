import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getTaxonomyService } from '@/server/taxonomy';
import { requireInt, requireIntFromQuery, requireString } from '@/server/common/http/validate';

/** `GET /api/taxonomy/stages?educationLevelId=` — requires `taxonomy.read` — ported from
 * `legacy/api/src/modules/taxonomy/api/taxonomy.controller.ts`'s `listStages`. */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'taxonomy.read');
    const educationLevelId = requireIntFromQuery(request.nextUrl.searchParams.get('educationLevelId'), 'educationLevelId');
    const rows = await getTaxonomyService().listStages(educationLevelId);
    return NextResponse.json(rows);
  });
}

/** `POST /api/taxonomy/stages` — requires `taxonomy.create`. FR-TAX-2's create-or-fetch, same
 * 200-vs-201 convention as `education-levels`. */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'taxonomy.create');

    const body: unknown = await request.json().catch(() => ({}));
    const educationLevelId = requireInt((body as { educationLevelId?: unknown })?.educationLevelId, 'educationLevelId');
    const name = requireString((body as { name?: unknown })?.name, 'name', { min: 1, max: 500 });

    const { entity, created } = await getTaxonomyService().createOrFetchStage(educationLevelId, name);
    return NextResponse.json(entity, { status: created ? 201 : 200 });
  });
}
