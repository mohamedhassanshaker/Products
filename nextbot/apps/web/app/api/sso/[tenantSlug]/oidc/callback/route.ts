import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { handleOidcCallback, iamTenantContext } from "@nextbot/iam";
import { SESSION_COOKIE } from "@/src/lib/session";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";
import { resolveTenantBySlug } from "@nextbot/tenancy";
import { SSO_FLOW_COOKIE } from "@/src/lib/sso-flow-cookie";
import { getClientIp } from "@/src/lib/client-ip";

/**
 * `GET /api/sso/{tenantSlug}/oidc/callback` (Phase 4, BL-36, FR-SEC-10). Fail
 * closed: a missing/mismatched flow cookie (CSRF/replay guard) or any token/
 * claims validation failure redirects to the ordinary login screen with a
 * generic error — never a partial session, never a distinguishing error message
 * for an unauthenticated caller.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const origin = new URL(request.url).origin;
  const store = await cookies();
  const flowRaw = store.get(SSO_FLOW_COOKIE)?.value;
  store.delete(SSO_FLOW_COOKIE);

  const fail = () => NextResponse.redirect(new URL("/login?error=sso_failed", origin));
  if (!flowRaw) return fail();
  let flow: { state: string; nonce: string; tenantSlug: string };
  try {
    flow = JSON.parse(flowRaw);
  } catch {
    return fail();
  }
  if (flow.tenantSlug !== tenantSlug) return fail();

  try {
    const result = await handleOidcCallback(tenantSlug, {
      currentUrl: new URL(request.url),
      expectedState: flow.state,
      expectedNonce: flow.nonce,
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
        details: { protocol: "Oidc" },
      });
    }
    return NextResponse.redirect(new URL("/dashboard", origin));
  } catch {
    return fail();
  }
}
