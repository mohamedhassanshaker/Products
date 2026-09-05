import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { getAuthService } from '@/server/auth';
import { parseJsonBody, requireEmail } from '@/server/common/http/validate';

/**
 * `POST /api/auth/forgot-password` — public, tenant-realm — ported behavior from
 * `legacy/api/src/modules/auth/api/auth.controller.ts`'s `forgotPassword`. Always `200` with
 * `{ ok: true }` regardless of whether the email exists — account existence is never disclosed.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const body = await parseJsonBody(request);
    const email = requireEmail(body.email);

    const auth = await getAuthService();
    await auth.forgotPassword({ email });
    return NextResponse.json({ ok: true }, { status: 200 });
  });
}
