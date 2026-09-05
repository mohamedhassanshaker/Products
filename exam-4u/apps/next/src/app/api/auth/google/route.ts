import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { getAuthService } from '@/server/auth';
import { parseJsonBody, requireString } from '@/server/common/http/validate';

/**
 * `POST /api/auth/google` — public, tenant-realm Google-sign-in bridge — ported behavior from
 * `legacy/api/src/modules/auth/api/auth.controller.ts`'s `google` handler
 * (`AuthService.signInWithGoogle`). Success is `200` with the identical `LoginResult` shape as
 * `/api/auth/login`. See `docs/plans/nextjs-rewrite-phase1-plan.md`'s "Decisions made" for why real
 * end-to-end Google verification isn't exercisable in this environment (`GOOGLE_CLIENT_ID` unset).
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const body = await parseJsonBody(request);
    const idToken = requireString(body.idToken, 'idToken', { min: 1, max: 4096 });

    const auth = await getAuthService();
    const result = await auth.signInWithGoogle(idToken);
    return NextResponse.json(result, { status: 200 });
  });
}
