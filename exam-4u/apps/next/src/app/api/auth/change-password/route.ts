import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { getAuthService, requireTenantUser } from '@/server/auth';
import { parseJsonBody, requireString } from '@/server/common/http/validate';

/**
 * `POST /api/auth/change-password` — tenant-realm, authenticated (`requireTenantUser`) — ported
 * behavior from `legacy/api/src/modules/auth/api/auth.controller.ts`'s `changePassword`. Success is
 * `200` with `{ ok: true }`.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);

    const body = await parseJsonBody(request);
    const currentPassword = requireString(body.currentPassword, 'currentPassword', { min: 1, max: 200 });
    const newPassword = requireString(body.newPassword, 'newPassword', { min: 1, max: 200 });

    const auth = await getAuthService();
    await auth.changePassword(principal.userId, { currentPassword, newPassword });
    return NextResponse.json({ ok: true }, { status: 200 });
  });
}
