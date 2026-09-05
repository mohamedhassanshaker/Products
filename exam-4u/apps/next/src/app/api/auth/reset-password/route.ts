import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { getAuthService } from '@/server/auth';
import { parseJsonBody, requireString } from '@/server/common/http/validate';

/**
 * `POST /api/auth/reset-password` — public, tenant-realm — ported behavior from
 * `legacy/api/src/modules/auth/api/auth.controller.ts`'s `resetPassword`. Success is `200` with
 * `{ ok: true }`.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const body = await parseJsonBody(request);
    const token = requireString(body.token, 'token', { min: 1, max: 512 });
    const newPassword = requireString(body.newPassword, 'newPassword', { min: 1, max: 200 });

    const auth = await getAuthService();
    await auth.resetPassword({ token, newPassword });
    return NextResponse.json({ ok: true }, { status: 200 });
  });
}
