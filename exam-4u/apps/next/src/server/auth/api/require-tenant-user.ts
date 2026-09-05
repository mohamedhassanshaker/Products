import type { NextRequest } from 'next/server';
import { getEnv } from '@/server/config';
import { getRequestContext } from '@/server/context';
import { UnauthenticatedError } from '@/server/common/errors/domain-error';
import { JwtTenantTokenAdapter } from '@/server/infrastructure/security';
import type { AuthenticatedTenantUser } from '../domain/auth.types';

/** Lazily constructed, `env`-bound token adapter — cheap to reconstruct per call (holds only a
 * secret string/TTL spec, no resource), same pattern as `context/with-platform-auth.ts`'s own
 * `tokenAdapter()`. */
function tokenAdapter(): JwtTenantTokenAdapter {
  const env = getEnv();
  return new JwtTenantTokenAdapter(env.JWT_TENANT_SECRET, env.JWT_TENANT_TTL);
}

/**
 * The tenant-realm equivalent of legacy's `JwtAuthGuard` — ported behavior from
 * `legacy/api/src/modules/auth/api/guards/jwt-auth.guard.ts`, adapted to a plain helper function
 * every tenant-realm-protected Route Handler calls (must run **inside** a
 * `withTenantContext`-wrapped handler, since it needs `getRequestContext()?.tenantId` for the
 * cross-tenant replay check below — calling this outside that binding throws, matching the "guard
 * order" invariant legacy enforces via `@UseGuards(JwtAuthGuard, PermissionsGuard)` ordering).
 *
 * Rejection order, each throwing {@link UnauthenticatedError} with the exact message legacy uses (all
 * three collapse to the identical `UNAUTHENTICATED`/401 envelope on the client side — only the
 * message differs, and only for server-side log correlation, never as a machine-readable signal):
 * 1. No/malformed `Authorization: Bearer <token>` header.
 * 2. Token fails verification (bad signature, expired, wrong `aud`/`iss`/`typ`, malformed).
 * 3. Token's `tenantId` claim doesn't match the tenant `middleware.ts` already resolved for this
 *    request (the cross-tenant replay barrier — a token minted for tenant A is rejected outright on
 *    tenant B's subdomain, even if otherwise perfectly valid).
 *
 * On success, mirrors `userId` onto the ALS {@link import('@/server/context').RequestContext} (so any
 * code that reads `getRequestContext()` directly, not just this function's return value, sees the
 * authenticated principal) — matching legacy's identical `current.userId = decoded.userId` mutation.
 */
export async function requireTenantUser(request: NextRequest): Promise<AuthenticatedTenantUser> {
  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthenticatedError('A bearer token is required to access this resource.');
  }

  const token = header.slice('Bearer '.length).trim();
  const decoded = await tokenAdapter().verify(token);
  if (!decoded) {
    throw new UnauthenticatedError('The provided token is invalid or has expired.');
  }

  const ctx = getRequestContext();
  if (!ctx?.tenantId || decoded.tenantId !== ctx.tenantId) {
    throw new UnauthenticatedError('This token is not valid for the current tenant.');
  }

  ctx.userId = decoded.userId;
  return { userId: decoded.userId, tenantId: decoded.tenantId };
}
