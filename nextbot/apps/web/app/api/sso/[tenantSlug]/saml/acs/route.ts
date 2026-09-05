import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { handleSamlCallback, iamTenantContext } from "@nextbot/iam";
import { resolveTenantBySlug } from "@nextbot/tenancy";
import { SESSION_COOKIE } from "@/src/lib/session";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";
import { SSO_FLOW_COOKIE } from "@/src/lib/sso-flow-cookie";
import { getClientIp } from "@/src/lib/client-ip";

/**
 * `POST /api/sso/{tenantSlug}/saml/acs` (Phase 4, BL-36, FR-SEC-10) — the SAML
 * Assertion Consumer Service endpoint the IdP POSTs its signed response to.
 * Same fail-closed posture as the OIDC callback: any validation failure (bad
 * signature, expired assertion, RelayState mismatch) redirects to a generic
 * login error, never a partial session.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const origin = new URL(request.url).origin;
  const store = await cookies();
  const flowRaw = store.get(SSO_FLOW_COOKIE)?.value;
  store.delete(SSO_FLOW_COOKIE);

  const fail = () => NextResponse.redirect(new URL("/login?error=sso_failed", origin));
  if (!flowRaw) return fail();
  let flow: { state: string; tenantSlug: string };
  try {
    flow = JSON.parse(flowRaw);
  } catch {
    return fail();
  }
  if (flow.tenantSlug !== tenantSlug) return fail();

  const form = await request.formData().catch(() => null);
  if (!form) return fail();
  const samlResponse = form.get("SAMLResponse");
  const relayState = form.get("RelayState");
  if (typeof samlResponse !== "string" || relayState !== flow.state) return fail();

  try {
    const callbackUrl = `${origin}/api/sso/${encodeURIComponent(tenantSlug)}/saml/acs`;
    const result = await handleSamlCallback(tenantSlug, {
      callbackUrl,
      body: { SAMLResponse: samlResponse, RelayState: String(relayState) },
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    store.set(SESSION_COOKIE, result.sessionToken, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });

    const tenant = await resolveTenantBySlug(tenantSlug);
    if (tenant) {
      await recordAdminAudit(iamTenantContext(tenant.id, tenant.region), {
        actorId: result.userId,
        actorLabel: result.userId,
        actionType: "user.sso_login",
        targetType: "User",
        targetId: result.userId,
        outcome: "Success",
        details: { protocol: "Saml" },
      });
    }
    return NextResponse.redirect(new URL("/dashboard", origin));
  } catch {
    return fail();
  }
}
