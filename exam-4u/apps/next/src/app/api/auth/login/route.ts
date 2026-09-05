import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { getAuthService } from '@/server/auth';
import { parseJsonBody, requireEmail, requireString } from '@/server/common/http/validate';

/**
 * `POST /api/auth/login` — public, tenant-realm — ported behavior from
 * `legacy/api/src/modules/auth/api/auth.controller.ts`'s `login`. Success is `200` with
 * `{ accessToken, expiresInSeconds, user }`.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const body = await parseJsonBody(request);
    const email = requireEmail(body.email);
    const password = requireString(body.password, 'password', { min: 1, max: 200 });

    const auth = await getAuthService();
    const result = await auth.login({ email, password });
    return NextResponse.json(result, { status: 200 });
  });
}
