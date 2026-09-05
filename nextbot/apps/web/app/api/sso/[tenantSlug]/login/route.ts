import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { handleSsoLoginStart } from "@nextbot/iam";
import { checkRateLimit } from "@/src/lib/rate-limit";
import { getClientIp } from "@/src/lib/client-ip";
import { SSO_FLOW_COOKIE } from "@/src/lib/sso-flow-cookie";

const START_LIMIT = 20;
const START_WINDOW_SECONDS = 60;

/**
 * `GET /api/sso/{tenantSlug}/login` (Phase 4, BL-36, FR-SEC-10) — SP-initiated
 * SSO: builds the IdP redirect and stashes `state`/`nonce` in a short-lived,
 * httpOnly cookie so the callback step can validate them against CSRF/replay
 * rather than trusting whatever the query string echoes back. Rate-limited —
 * this is an unauthenticated, IdP-bound redirect endpoint (the "expensive/
 * auth-related endpoint" class the security brief calls out).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;

  const rateLimit = await checkRateLimit(`sso-login-start:${getClientIp(request)}`, START_LIMIT, START_WINDOW_SECONDS);
  if (!rateLimit.allowed) {
    return NextResponse.json({ type: "about:blank", title: "Too many requests.", status: 429 }, { status: 429 });
  }

  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const origin = new URL(request.url).origin;
  const encodedSlug = encodeURIComponent(tenantSlug);

  try {
    const { url } = await handleSsoLoginStart(tenantSlug, {
      oidcCallbackUrl: `${origin}/api/sso/${encodedSlug}/oidc/callback`,
      samlCallbackUrl: `${origin}/api/sso/${encodedSlug}/saml/acs`,
      state,
      nonce,
    });
    const store = await cookies();
    store.set(SSO_FLOW_COOKIE, JSON.stringify({ state, nonce, tenantSlug }), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 300,
      secure: process.env.NODE_ENV === "production",
    });
    return NextResponse.redirect(url);
  } catch {
    // Fail closed: any resolution/build failure (unconfigured/inactive
    // connection, unresolvable tenant) redirects back to the ordinary login
    // screen rather than exposing an SSO-specific error to an unauthenticated
    // caller (never a hint about which tenants have SSO configured).
    return NextResponse.redirect(new URL("/login?error=sso_unavailable", origin));
  }
}
