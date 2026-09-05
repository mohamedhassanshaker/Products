import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@/server/config';
import { requireTenantId, withTenantContext } from '@/server/context';
import { getTenantsService } from '@/server/platform/tenants';

/**
 * `GET /api/tenant/public-config` — public, tenant-realm — ported behavior from
 * `legacy/api/src/modules/auth/api/tenant-config.controller.ts`. Drives the pre-login screen: the
 * frontend fetches this **before** rendering login/register, so it knows the tenant's branding and
 * which entry points (self-registration, Google sign-in) to show — the tenant itself is already
 * resolved from the `Host` header by `middleware.ts`, so this route never asks the user to pick one.
 *
 * `googleClientId` is present with a value only when `GOOGLE_CLIENT_ID` is configured server-side —
 * omitted entirely (never `null`/empty string) otherwise, matching legacy's exact wire-shape contract.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const tenantsService = await getTenantsService();
    const tenant = await tenantsService.get(requireTenantId());
    const env = getEnv();
    const googleClientId = env.GOOGLE_CLIENT_ID || undefined;

    return NextResponse.json({
      name: tenant.name,
      logoUrl: tenant.logoUrl,
      allowEmailRegistration: tenant.allowEmailRegistration,
      allowGoogleSignIn: tenant.allowGoogleSignIn,
      ...(googleClientId ? { googleClientId } : {}),
      accentColor: tenant.accentColorOverride ?? env.THEME_DEFAULT_ACCENT_COLOR,
    });
  });
}
