/** Shared cookie name for the SSO login flow's CSRF/replay guard (Phase 4,
 * BL-36) — used by both `/api/sso/[tenantSlug]/login` (sets it) and the OIDC/
 * SAML callback routes (validate + delete it). Kept in a plain lib module
 * rather than exported from the login route file so it isn't coupled to that
 * route's own module resolution. */
export const SSO_FLOW_COOKIE = "nb_sso_flow";
