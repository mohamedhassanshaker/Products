import "server-only";
import { cookies, headers } from "next/headers";
import { verifySessionToken, isSessionActive, iamTenantContext, verifyApiKey, type SessionClaims } from "@nextbot/iam";
import { resolveTenantById } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";

export const SESSION_COOKIE = "nb_session";

/**
 * Reads and verifies the current request's session cookie, or `null` if absent/
 * invalid/revoked/expired.
 *
 * Phase 4 (BL-36, FR-SEC-10): beyond the pre-existing stateless JWT signature
 * check, this now also confirms the session's persisted `auth_session` row is
 * still active (not revoked, not past its DB-side expiry) — a JWT signature
 * alone can never express "this session was just revoked," so a revoked session
 * must fail this DB check on the very next request, not merely once the JWT's
 * own `exp` eventually elapses. A missing/absent `sid` claim (should not occur
 * on any token issued by this phase's login paths) is treated as inactive,
 * fail-closed, rather than "skip the check."
 */
export async function getSession(): Promise<SessionClaims | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const claims = await verifySessionToken(token);
    if (!claims.sid) return null;
    const tenant = await resolveTenantById(claims.tenantId);
    if (!tenant) return null;
    const active = await isSessionActive(iamTenantContext(claims.tenantId, tenant.region), claims.sid);
    if (!active) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Phase 4 (BL-36, FR-API-01): resolves the caller's `AuthContext` for
 * `/api/v1/admin/**` — a Better-Auth-style session cookie **or** a tenant-scoped
 * service-account API key (`Authorization: Bearer nbk_…`), per LLD §5.1. A
 * service-account key never carries the *human* `roleIds`/session-cookie shape;
 * it resolves to the same `SessionClaims` shape (so every downstream
 * `requirePermission()` call works unchanged) with the service account's own
 * effective (role ∩ key-scope) permission matrix baked in.
 */
export async function getAuthContext(): Promise<SessionClaims | null> {
  const cookieSession = await getSession();
  if (cookieSession) return cookieSession;

  const hdrs = await headers();
  const authHeader = hdrs.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const rawKey = authHeader.slice("Bearer ".length).trim();
  if (!rawKey.startsWith("nbk_")) return null;

  try {
    return await verifyApiKey(rawKey);
  } catch {
    return null;
  }
}

/** Builds a `TenantContext` for the current session (looking up the tenant's region,
 * since the session token itself doesn't carry it — see `session-token.ts`). Route
 * handlers use this to call into module application services. */
export async function getSessionTenantContext(session: SessionClaims): Promise<TenantContext> {
  const tenant = await resolveTenantById(session.tenantId);
  if (!tenant) throw new Error("Session references a tenant that no longer exists.");
  return { tenantId: session.tenantId, region: tenant.region, environment: "Sandbox" };
}
