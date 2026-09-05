import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getUsersService } from '@/server/users';
import { parseJsonBody, requireString } from '@/server/common/http/validate';

/** `GET /api/users/:id` — requires `users.read`. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'users.read');
    const { id } = await params;
    return NextResponse.json(await getUsersService().get(id));
  });
}

/** `PATCH /api/users/:id` — requires `users.update`. Identity/profile fields + the active/inactive
 * toggle only — email, password, and role grants are deliberately not part of this route (see
 * `UsersService.update`'s doc comment for why each is excluded). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'users.update');
    const { id } = await params;

    const body = await parseJsonBody(request);
    const firstName = body.firstName === undefined ? undefined : requireString(body.firstName, 'firstName', { min: 1, max: 100 });
    const lastName = body.lastName === undefined ? undefined : requireString(body.lastName, 'lastName', { min: 1, max: 100 });
    const phone = body.phone === undefined ? undefined : body.phone === null ? null : requireString(body.phone, 'phone', { min: 0, max: 40 });
    const occupation =
      body.occupation === undefined ? undefined : body.occupation === null ? null : requireString(body.occupation, 'occupation', { min: 0, max: 150 });
    const companyName =
      body.companyName === undefined
        ? undefined
        : body.companyName === null
          ? null
          : requireString(body.companyName, 'companyName', { min: 0, max: 200 });
    const country =
      body.country === undefined ? undefined : body.country === null ? null : requireString(body.country, 'country', { min: 0, max: 100 });
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : undefined;

    const updated = await getUsersService().update(id, { firstName, lastName, phone, occupation, companyName, country, isActive });
    return NextResponse.json(updated);
  });
}

/** `DELETE /api/users/:id` — requires `users.delete`. Success is `204` (no body). Hard-deletes the
 * account (FR-IAM-7); rejected with `LAST_ADMIN_PROTECTED` if `id` is the tenant's sole Tenant Admin. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'users.delete');
    const { id } = await params;
    await getUsersService().delete(id);
    return new NextResponse(null, { status: 204 });
  });
}
