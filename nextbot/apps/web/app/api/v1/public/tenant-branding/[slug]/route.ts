import { NextResponse, type NextRequest } from "next/server";
import { TENANT_SLUG_PATTERN, type PublicTenantBrandingResponse } from "@nextbot/contracts";
import { resolveTenantBySlug, getTenantBranding } from "@nextbot/tenancy";
import { checkRateLimit } from "@/src/lib/rate-limit";
import { getClientIp } from "@/src/lib/client-ip";
import { pickForegroundForContrast } from "@/src/lib/build-brand-style-tag";

/** BE2-style ceiling (same pattern as the widget's anonymous session-create
 * endpoint): generous for any real visitor (the login screen looks this up once
 * per tenant-slug blur/submit), blocks a naive enumeration/flood attempt against
 * an unauthenticated surface. */
const LOOKUP_LIMIT = 30;
const LOOKUP_WINDOW_SECONDS = 60;

/** The single shared "nothing to see here" response — returned for BOTH a
 * nonexistent tenant slug AND an existing tenant with white-labeling disabled, so
 * this endpoint can never be used to enumerate which tenant slugs exist or which
 * have white-labeling on (FR-ADM-07 Part 2 security constraint). */
const DEFAULT_RESPONSE: PublicTenantBrandingResponse = {
  whiteLabelEnabled: false,
  primaryColor: null,
  accentForeground: null,
  logoUrl: null,
  tenantName: null,
};

/**
 * `GET /api/v1/public/tenant-branding/{slug}` — unauthenticated, rate-limited
 * lookup used by the login screen to render the tenant's brand accent/logo
 * before the caller has signed in (FR-ADM-07: "the same primary/accent colors and
 * logo replace NextBot's default admin theme in the top bar and login screen").
 *
 * Deliberately returns ONLY the fields needed for login-screen rendering — no
 * user data, no other tenant config — and the exact same generic
 * `DEFAULT_RESPONSE` shape whether the slug doesn't resolve to any tenant or
 * resolves to a tenant that simply hasn't enabled white-labeling. Never a 404,
 * never a distinguishing error message: either would let an anonymous caller
 * enumerate tenant slugs or their white-labeling status, a real (if minor)
 * information-disclosure vector on a public, unauthenticated surface.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const rateLimit = await checkRateLimit(`tenant-branding-lookup:${getClientIp(request)}`, LOOKUP_LIMIT, LOOKUP_WINDOW_SECONDS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { type: "about:blank", title: "Too many requests — please slow down and try again shortly.", status: 429 },
      { status: 429, headers: { "Retry-After": String(LOOKUP_WINDOW_SECONDS) } },
    );
  }

  // A malformed slug (wrong shape/length) can never match a real tenant row —
  // reject it the same generic way as "not found" rather than a distinct 400,
  // keeping the response shape uniform for every non-white-labeled outcome.
  if (!TENANT_SLUG_PATTERN.test(slug)) {
    return NextResponse.json(DEFAULT_RESPONSE);
  }

  const tenant = await resolveTenantBySlug(slug);
  if (!tenant) {
    return NextResponse.json(DEFAULT_RESPONSE);
  }

  const branding = await getTenantBranding(tenant.id);
  if (!branding?.whiteLabelEnabled || !branding.brandingConfig) {
    return NextResponse.json(DEFAULT_RESPONSE);
  }

  const response: PublicTenantBrandingResponse = {
    whiteLabelEnabled: true,
    primaryColor: branding.brandingConfig.primaryColor,
    // Reuses the same `pickForegroundForContrast` helper as the Admin Console
    // shell's `--brand-accent-foreground` — never a second/divergent copy.
    accentForeground: pickForegroundForContrast(branding.brandingConfig.primaryColor),
    logoUrl: branding.brandingConfig.logoLightUrl,
    tenantName: tenant.name,
  };
  return NextResponse.json(response);
}
