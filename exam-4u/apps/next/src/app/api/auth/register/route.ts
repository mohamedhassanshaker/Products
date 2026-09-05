import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { getAuthService } from '@/server/auth';
import { parseJsonBody, requireEmail, requireString } from '@/server/common/http/validate';

/**
 * `POST /api/auth/register` — public (no bearer token required), tenant-realm — ported behavior from
 * `legacy/api/src/modules/auth/api/auth.controller.ts`'s `register`. Success is `201` with
 * `{ user: {...} }` and **no** `accessToken` — the client calls `/api/auth/login` next.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const body = await parseJsonBody(request);
    const email = requireEmail(body.email);
    const password = requireString(body.password, 'password', { min: 1, max: 200 });
    const firstName = requireString(body.firstName, 'firstName', { min: 1, max: 100 });
    const lastName = requireString(body.lastName, 'lastName', { min: 1, max: 100 });

    const auth = await getAuthService();
    const result = await auth.register({ email, password, firstName, lastName });
    return NextResponse.json(result, { status: 201 });
  });
}
