import { buildSsoLoginUrl, completeOidcLogin, completeSamlLogin, type SsoLoginSuccess } from "../application/sso-login.js";

/** SSO login entry points (Phase 4, BL-36, FR-SEC-10) — unauthenticated by
 * definition (this IS the authentication step), same convention `handleLogin`
 * uses for the password path in `admin-routes.ts`. */

export async function handleSsoLoginStart(
  tenantSlug: string,
  input: { oidcCallbackUrl: string; samlCallbackUrl: string; state: string; nonce: string },
) {
  return buildSsoLoginUrl(tenantSlug, input);
}

export async function handleOidcCallback(
  tenantSlug: string,
  input: { currentUrl: URL; expectedState: string; expectedNonce: string; ip?: string; userAgent?: string },
): Promise<SsoLoginSuccess> {
  return completeOidcLogin(tenantSlug, input);
}

export async function handleSamlCallback(
  tenantSlug: string,
  input: { callbackUrl: string; body: Record<string, string>; ip?: string; userAgent?: string },
): Promise<SsoLoginSuccess> {
  return completeSamlLogin(tenantSlug, input);
}
