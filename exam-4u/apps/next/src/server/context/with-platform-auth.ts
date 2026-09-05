import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getEnv } from '@/server/config';
import { toErrorResponse } from '@/server/common/http/error-envelope';
import { UnauthenticatedError } from '@/server/common/errors/domain-error';
import { JwtPlatformTokenAdapter } from '@/server/infrastructure/security';
import { runWithRequestContext } from './request-context';

/** Authenticated platform-realm principal, mirroring legacy's `AuthenticatedPlatformAdmin`. */
export interface AuthenticatedPlatformAdmin {
  adminId: string;
}

/** Lazily constructed, `env`-bound token adapter — this module's own tiny composition point (no
 * `globalThis` cache needed: the adapter itself holds no resource, just a secret string/TTL spec, so
 * re-constructing it per call is cheap and always reflects the current `getEnv()` snapshot). */
function tokenAdapter(): JwtPlatformTokenAdapter {
  const env = getEnv();
  return new JwtPlatformTokenAdapter(env.JWT_PLATFORM_SECRET, env.JWT_PLATFORM_TTL);
}

/**
 * The platform-realm equivalent of {@link import('./with-tenant-context').withTenantContext} —
 * ported behavior from legacy's `PlatformAdminGuard` (`legacy/api/src/platform/auth/api/guards/
 * platform-admin.guard.ts`), adapted from a NestJS guard to a Route Handler wrapper since this app has
 * no guard/decorator mechanism. Verifies the `Authorization: Bearer <token>` header against
 * `JWT_PLATFORM_SECRET`, then runs `handler` with the platform-admin id bound both as this function's
 * own parameter *and* mirrored into the ALS {@link import('./request-context').RequestContext} (so any
 * code `handler` calls can also read it via `getRequestContext()?.platformAdminId`).
 *
 * No tenant `DataSource` is acquired here — the platform realm always uses the single, non-tenant-
 * scoped platform `DataSource` (`getPlatformDataSource()`), never a per-tenant one. Matches legacy's
 * own structural guarantee that `platform_admin` is never resolvable through any tenant connection.
 *
 * @throws Nothing — every rejection is translated to a `NextResponse` `ErrorEnvelope` (401
 *   `UNAUTHENTICATED`) directly, exactly mirroring `PlatformAdminGuard`'s two rejection messages.
 */
export async function withPlatformAuth(
  request: NextRequest,
  handler: (principal: AuthenticatedPlatformAdmin) => Promise<Response>,
): Promise<Response> {
  const requestId = request.headers.get('x-request-id') ?? randomUUID();
  const routeLabel = `${request.method} ${request.nextUrl.pathname}`;

  try {
    const header = request.headers.get('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthenticatedError('A bearer token is required to access this resource.');
    }
    const token = header.slice('Bearer '.length).trim();
    const decoded = await tokenAdapter().verify(token);
    if (!decoded) {
      throw new UnauthenticatedError('The provided token is invalid or has expired.');
    }

    const principal: AuthenticatedPlatformAdmin = { adminId: decoded.adminId };
    return await runWithRequestContext({ requestId, platformAdminId: principal.adminId }, () => handler(principal));
  } catch (err) {
    return toErrorResponse(err, requestId, routeLabel);
  }
}
