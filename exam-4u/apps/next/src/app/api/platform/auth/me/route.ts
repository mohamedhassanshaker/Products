import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { NotFoundDomainError } from '@/server/common/errors/domain-error';
import { getPlatformAdminAuthService } from '@/server/platform/auth';

/**
 * `GET /api/platform/auth/me` — platform-realm, authenticated (`withPlatformAuth`) — ported behavior
 * from `legacy/api/src/platform/auth/api/platform-auth.controller.ts`'s `me`. Success is `200` with
 * the bare `PlatformAdminSummary` object (no wrapper).
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const service = await getPlatformAdminAuthService();
    const admin = await service.getById(principal.adminId);
    if (!admin) {
      throw new NotFoundDomainError('Platform admin not found.');
    }
    return NextResponse.json(admin);
  });
}
