import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { toErrorResponse } from '@/server/common/http/error-envelope';
import { parseJsonBody, requireEmail, requireString } from '@/server/common/http/validate';
import { getPlatformAdminAuthService } from '@/server/platform/auth';

/**
 * `POST /api/platform/auth/login` — public, platform-realm — ported behavior from
 * `legacy/api/src/platform/auth/api/platform-auth.controller.ts`'s `login`. Never tenant-resolved
 * (excluded from `middleware.ts`'s matcher) — reachable with no `Host`-header tenant concept at all,
 * so this route does its own lightweight try/catch → `toErrorResponse` rather than going through
 * `withTenantContext`/`withPlatformAuth` (neither fits: there is no tenant here, and no bearer token
 * exists *yet* — that's what this endpoint issues).
 */
export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get('x-request-id') ?? randomUUID();
  try {
    const body = await parseJsonBody(request);
    const email = requireEmail(body.email);
    const password = requireString(body.password, 'password', { min: 1, max: 200 });

    const service = await getPlatformAdminAuthService();
    const result = await service.login({ email, password });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, requestId, `POST ${request.nextUrl.pathname}`);
  }
}
