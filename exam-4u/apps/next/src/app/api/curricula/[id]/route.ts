import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantId, withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getCurriculaService } from '@/server/curricula';
import { optionalString } from '@/server/common/http/validate';

/** `GET /api/curricula/:id` — requires `curricula.manage_own`; ownership/oversight is then enforced
 * inside `CurriculaService` itself (a non-owner without `curricula.read_all` gets `403
 * NOT_CURRICULUM_OWNER`, never a 404 — FR-CUR-1a). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'curricula.manage_own');
    const { id } = await params;
    const result = await getCurriculaService().get(principal.userId, id);
    return NextResponse.json(result);
  });
}

/** `PATCH /api/curricula/:id` — requires `curricula.manage_own`. Partial update — `name`/`description`
 * only, matching legacy's identical field set. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'curricula.manage_own');
    const { id } = await params;

    const body: unknown = await request.json().catch(() => ({}));
    const name = optionalString((body as { name?: unknown })?.name, 'name', { min: 2, max: 200 });
    const description = optionalString((body as { description?: unknown })?.description, 'description', { min: 0, max: 1000 });

    const updated = await getCurriculaService().update(principal.userId, id, { name, description });
    return NextResponse.json(updated);
  });
}

/** `DELETE /api/curricula/:id` — requires `curricula.manage_own`. Success is `204` (no body). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'curricula.manage_own');
    const { id } = await params;
    // `tenantId` is passed explicitly because deletion now also purges the Curriculum's indexed Qdrant
    // chunks (Phase 6 sub-slice "6b"), and the vector store is tenant-scoped by payload, not by schema.
    await getCurriculaService().delete(principal.userId, requireTenantId(), id);
    return new NextResponse(null, { status: 204 });
  });
}
