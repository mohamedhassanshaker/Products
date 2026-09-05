import { NextResponse, type NextRequest } from "next/server";
import { TENANT_SLUG_PATTERN } from "@nextbot/contracts";
import { resolveTenantBySlug } from "@nextbot/tenancy";
import { getSsoConnectionConfig, iamTenantContext } from "@nextbot/iam";
import { checkRateLimit } from "@/src/lib/rate-limit";
import { getClientIp } from "@/src/lib/client-ip";

const LOOKUP_LIMIT = 30;
const LOOKUP_WINDOW_SECONDS = 60;

/**
 * `GET /api/v1/public/sso-status/{slug}` — Phase 4 (BL-36, FR-SEC-10). Unauthenticated,
 * rate-limited lookup the login screen uses to decide whether to render a real
 * "Sign in with SSO" link or the existing disabled/informational affordance
 * (QA Defect U8's "honestly inert" placeholder). Mirrors
 * `tenant-branding/[slug]/route.ts`'s enumeration-safety shape exactly: an
 * unknown slug and a real tenant with no Active SSO connection return the
 * identical `{ enabled: false }`, so this endpoint can never be used to
 * enumerate which tenant slugs exist or which have SSO configured.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const rateLimit = await checkRateLimit(`sso-status-lookup:${getClientIp(request)}`, LOOKUP_LIMIT, LOOKUP_WINDOW_SECONDS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { type: "about:blank", title: "Too many requests — please slow down and try again shortly.", status: 429 },
      { status: 429, headers: { "Retry-After": String(LOOKUP_WINDOW_SECONDS) } },
    );
  }

  if (!TENANT_SLUG_PATTERN.test(slug)) return NextResponse.json({ enabled: false });

  const tenant = await resolveTenantBySlug(slug);
  if (!tenant) return NextResponse.json({ enabled: false });

  const connection = await getSsoConnectionConfig(iamTenantContext(tenant.id, tenant.region));
  return NextResponse.json({ enabled: connection?.status === "Active" });
}
