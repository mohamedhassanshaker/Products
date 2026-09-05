import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { getRolesService, requirePermission, RoleNotFoundError } from '@/server/rbac';
import { parseJsonBody, requireString } from '@/server/common/http/validate';

/** A non-numeric `:id` segment is treated identically to "no such role" (404) — never a 400/500. */
function parseRoleId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) throw new RoleNotFoundError();
  return id;
}

/** `GET /api/roles/:id` — requires `roles.read`. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'roles.read');
    const { id } = await params;
    return NextResponse.json(await getRolesService().get(parseRoleId(id)));
  });
}

/** `PATCH /api/roles/:id` — requires `roles.update`. Renaming/deleting a system role is rejected by
 * the service layer (`SystemRoleProtectedError`); permission-grant changes are a separate route
 * (`PUT /api/roles/:id/permissions`). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'roles.update');
    const { id } = await params;

    const body = await parseJsonBody(request);
    const name = body.name === undefined ? undefined : requireString(body.name, 'name', { min: 1, max: 100 });
    const description =
      body.description === undefined
        ? undefined
        : body.description === null
          ? null
          : requireString(body.description, 'description', { min: 0, max: 300 });

    const updated = await getRolesService().update(parseRoleId(id), { name, description });
    return NextResponse.json(updated);
  });
}

/** `DELETE /api/roles/:id` — requires `roles.delete`. Success is `204` (no body). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'roles.delete');
    const { id } = await params;
    await getRolesService().delete(parseRoleId(id));
    return new NextResponse(null, { status: 204 });
  });
}
