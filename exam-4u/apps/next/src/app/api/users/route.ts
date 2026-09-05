import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getUsersService } from '@/server/users';
import { parseJsonBody, requireEmail, requireString } from '@/server/common/http/validate';
import type { UserSortColumn } from '@/server/users';

const SORT_COLUMNS: UserSortColumn[] = ['email', 'firstName', 'lastName', 'createdAt', 'lastLoginAt'];

/** `GET /api/users` — tenant-realm, requires `users.read` — ported from
 * `legacy/api/src/modules/users/api/users.controller.ts`'s `list` (FR-IAM-7: paginated search/sort). */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'users.read');

    const query = request.nextUrl.searchParams;
    const sortByRaw = query.get('sortBy');
    const sortDirRaw = query.get('sortDir');
    const pageRaw = query.get('page');
    const pageSizeRaw = query.get('pageSize');

    const users = getUsersService();
    const result = await users.list({
      search: query.get('search') ?? undefined,
      sortBy: sortByRaw && (SORT_COLUMNS as string[]).includes(sortByRaw) ? (sortByRaw as UserSortColumn) : undefined,
      sortDir: sortDirRaw === 'asc' || sortDirRaw === 'desc' ? sortDirRaw : undefined,
      page: pageRaw ? Number(pageRaw) : undefined,
      pageSize: pageSizeRaw ? Number(pageSizeRaw) : undefined,
    });
    return NextResponse.json(result);
  });
}

/** `POST /api/users` — tenant-realm, requires `users.create` — ported from
 * `legacy/api/src/modules/users/api/users.controller.ts`'s `create`. Success is `201`. */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'users.create');

    const body = await parseJsonBody(request);
    const email = requireEmail(body.email);
    const firstName = requireString(body.firstName, 'firstName', { min: 1, max: 100 });
    const lastName = requireString(body.lastName, 'lastName', { min: 1, max: 100 });
    const password = body.password === undefined ? undefined : requireString(body.password, 'password', { min: 1, max: 200 });
    const phone = body.phone === undefined || body.phone === null ? undefined : requireString(body.phone, 'phone', { min: 0, max: 40 });
    const occupation =
      body.occupation === undefined || body.occupation === null ? undefined : requireString(body.occupation, 'occupation', { min: 0, max: 150 });
    const companyName =
      body.companyName === undefined || body.companyName === null
        ? undefined
        : requireString(body.companyName, 'companyName', { min: 0, max: 200 });
    const country = body.country === undefined || body.country === null ? undefined : requireString(body.country, 'country', { min: 0, max: 100 });
    const roleIds = Array.isArray(body.roleIds) ? body.roleIds.filter((v): v is number => typeof v === 'number') : undefined;

    const users = getUsersService();
    const created = await users.create({ email, firstName, lastName, password, phone, occupation, companyName, country, roleIds });
    return NextResponse.json(created, { status: 201 });
  });
}
