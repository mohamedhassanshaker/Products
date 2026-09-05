import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { headers } from 'next/headers';
import { Provider } from '@/components/ui/provider';
import { accentScaleToCssVars, deriveAccentScale } from '@/components/theme/accent-scale';
import { getEnv } from '@/server/config';
import { getTenantsService } from '@/server/platform/tenants';
import { logger } from '@/server/logging';

export const metadata: Metadata = {
  title: 'ExamLand',
  description: 'ExamLand — multi-tenant SaaS exam platform (Next.js rewrite, migration Phase 0).',
};

/**
 * Resolves the CSS custom properties every page's `<html>` needs for `components/theme/system.ts`'s
 * `brand.{50..900}` tokens to resolve to a real color (migration plan, FR-MT-10: "Server-render the
 * CSS var on `<html>` in the root layout to eliminate the FOUC the Angular client-fetch pattern had to
 * tolerate").
 *
 * Reads `x-tenant-id` — the trusted header `middleware.ts` sets once it resolves a tenant from the
 * `Host` header — directly via `next/headers`, rather than a client-side fetch: this is exactly what
 * removes the FOUC legacy's Angular client had to tolerate (its `TenantConfigStore` only resolves
 * *after* first paint). On a platform-console/public route (no tenant resolved, `x-tenant-id` absent —
 * `middleware.ts`'s matcher excludes those paths entirely) or if the tenant lookup itself fails for any
 * reason, this falls back to the platform default (`THEME_DEFAULT_ACCENT_COLOR`) — a themed page must
 * never fail to render because branding lookup failed.
 *
 * Reading `getTenantsService()`/hitting the platform `DataSource` directly from a Server Component
 * (rather than an HTTP round-trip to `GET /api/tenant/branding`) is a deliberate, in-process shortcut:
 * this Server Component already runs inside the same Node process/request as the eventual Route
 * Handler would, so an internal HTTP call here would just add one extra network hop for no isolation
 * benefit — `server/platform/tenants`'s own module-boundary barrel is still the only entry point used.
 */
async function resolveAccentCssVars(): Promise<CSSProperties> {
  const env = getEnv();
  let effectiveAccentColor = env.THEME_DEFAULT_ACCENT_COLOR;

  try {
    const requestHeaders = await headers();
    const tenantId = requestHeaders.get('x-tenant-id');
    if (tenantId) {
      const service = await getTenantsService();
      const branding = await service.getBranding(tenantId);
      effectiveAccentColor = branding.effectiveAccentColor;
    }
  } catch (err) {
    // Never let a branding-lookup failure break page rendering (e.g. a tenant deleted between
    // `middleware.ts`'s resolution and this Server Component's own render, or a transient DB error) —
    // fall back to the platform default and log server-side only.
    logger.warn({ err }, 'theme.accent_resolution_failed_falling_back_to_default');
  }

  return accentScaleToCssVars(deriveAccentScale(effectiveAccentColor)) as CSSProperties;
}

/**
 * Root layout — mounts the single Chakra {@link Provider} (migration plan §"New app structure":
 * `components/ui/`, `components/theme/` Chakra v3 system + design system) and server-renders the
 * `--brand-accent-*` CSS custom properties directly onto `<html>`'s `style` attribute, so the very
 * first byte of HTML already carries the acting tenant's real accent color — no client-side fetch,
 * no flash of the platform-default color before the real one applies.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const accentCssVars = await resolveAccentCssVars();

  return (
    <html lang="en" style={accentCssVars}>
      <body>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
