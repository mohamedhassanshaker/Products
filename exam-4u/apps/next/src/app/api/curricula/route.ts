import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getCurriculaService } from '@/server/curricula';
import { optionalString, requireInt, requireString } from '@/server/common/http/validate';

/** `GET /api/curricula` — tenant-realm, requires `curricula.manage_own` — ported from
 * `legacy/api/src/modules/curricula/api/curricula.controller.ts`'s `list`. Returns the acting user's
 * own curricula, or every curriculum in the tenant if they additionally hold `curricula.read_all`
 * (`CurriculaService.list`'s own logic — this route never branches on that itself). */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'curricula.manage_own');
    const rows = await getCurriculaService().list(principal.userId);
    return NextResponse.json(rows);
  });
}

/** `POST /api/curricula` — requires `curricula.manage_own`. Ownership is not a guard (HLD §5.2) — any
 * user who can reach this route at all may create a Curriculum owned by themselves (FR-CUR-1). Success
 * is `201`. */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'curricula.manage_own');

    const body: unknown = await request.json().catch(() => ({}));
    const name = requireString((body as { name?: unknown })?.name, 'name', { min: 2, max: 200 });
    const description = optionalString((body as { description?: unknown })?.description, 'description', { min: 0, max: 1000 });
    const subjectId = requireInt((body as { subjectId?: unknown })?.subjectId, 'subjectId');

    const created = await getCurriculaService().create(principal.userId, { name, description, subjectId });
    return NextResponse.json(created, { status: 201 });
  });
}
