import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getTaxonomyService } from '@/server/taxonomy';
import { requireString } from '@/server/common/http/validate';

/** `GET /api/taxonomy/education-levels` — tenant-realm, requires `taxonomy.read` — ported from
 * `legacy/api/src/modules/taxonomy/api/taxonomy.controller.ts`'s `listEducationLevels`. */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'taxonomy.read');
    const rows = await getTaxonomyService().listEducationLevels();
    return NextResponse.json(rows);
  });
}

/** `POST /api/taxonomy/education-levels` — requires `taxonomy.create`. FR-TAX-2's create-or-fetch:
 * existing name -> `200` with the existing entry; new -> `201` — the status is set explicitly from
 * `TaxonomyService`'s own `created` flag, ported from the controller's identical
 * `res.status(created ? HttpStatus.CREATED : HttpStatus.OK)` pattern. */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'taxonomy.create');

    const body: unknown = await request.json().catch(() => ({}));
    const name = requireString((body as { name?: unknown })?.name, 'name', { min: 1, max: 500 });

    const { entity, created } = await getTaxonomyService().createOrFetchEducationLevel(name);
    return NextResponse.json(entity, { status: created ? 201 : 200 });
  });
}
