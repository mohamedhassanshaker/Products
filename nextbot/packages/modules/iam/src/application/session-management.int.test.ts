import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { resolveTenantById } from "@nextbot/tenancy";
import { seedSystemRoles } from "./seed-system-roles.js";
import { registerUser } from "./register-user.js";
import { login } from "./authenticate-user.js";
import { verifySessionToken } from "./session-token.js";
import { isSessionActive } from "../infrastructure/session-repository.js";
import { adminRevokeAllSessionsForUser, adminRevokeSession, listMySessions, listTenantSessions, revokeAllMySessions, revokeMySession } from "./session-management.js";
import { iamTenantContext } from "../infrastructure/user-repository.js";
import { SessionNotFoundError } from "@nextbot/contracts";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function loginAndGetSession(password = "correct-horse-battery-staple") {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  await seedSystemRoles(ctx);
  const userId = await registerUser(ctx, { email: "admin@example.com", password, displayName: "Admin", roleName: "Tenant Admin" });
  const tenant = await resolveTenantById(ctx.tenantId);
  const result = await login({ tenantSlug: tenant!.slug, email: "admin@example.com", password });
  if (result.outcome !== "authenticated") throw new Error("expected authenticated");
  return { ctx, userId, sessionToken: result.sessionToken };
}

describe("session management (Phase 4, BL-36, FR-SEC-10) — real Postgres", () => {
  it("a real login creates a persisted, active auth_session whose id is embedded as the JWT's sid claim", async () => {
    const { ctx, sessionToken } = await loginAndGetSession();
    const claims = await verifySessionToken(sessionToken);
    expect(claims.sid).toBeTruthy();
    await expect(isSessionActive(ctx, claims.sid!)).resolves.toBe(true);
  });

  it("lists exactly the caller's own active sessions", async () => {
    const { ctx, userId, sessionToken } = await loginAndGetSession();
    const claims = await verifySessionToken(sessionToken);
    const sessions = await listMySessions(ctx, userId);
    expect(sessions.map((s) => s.id)).toContain(claims.sid);
  });

  it("SECURITY-CRITICAL: revoking a session makes isSessionActive() false on the VERY NEXT check — no cache/delay window", async () => {
    const { ctx, userId, sessionToken } = await loginAndGetSession();
    const claims = await verifySessionToken(sessionToken);
    await expect(isSessionActive(ctx, claims.sid!)).resolves.toBe(true);

    await revokeMySession(ctx, userId, claims.sid!);

    // No sleep, no retry loop — the very next call must already reflect the
    // revocation, proving there is no TTL/cache layer sitting in between.
    await expect(isSessionActive(ctx, claims.sid!)).resolves.toBe(false);
  });

  it("a revoked session's active-check returns false permanently (not just once)", async () => {
    const { ctx, userId, sessionToken } = await loginAndGetSession();
    const claims = await verifySessionToken(sessionToken);
    await revokeMySession(ctx, userId, claims.sid!);
    await expect(isSessionActive(ctx, claims.sid!)).resolves.toBe(false);
    await expect(isSessionActive(ctx, claims.sid!)).resolves.toBe(false);
  });

  it("'sign out everywhere' revokes every active session for the user", async () => {
    const { ctx, userId, sessionToken: firstSession } = await loginAndGetSession();
    const tenant = await resolveTenantById(ctx.tenantId);
    const second = await login({ tenantSlug: tenant!.slug, email: "admin@example.com", password: "correct-horse-battery-staple" });
    if (second.outcome !== "authenticated") throw new Error("expected authenticated");

    const claims1 = await verifySessionToken(firstSession);
    const claims2 = await verifySessionToken(second.sessionToken);
    await expect(isSessionActive(ctx, claims1.sid!)).resolves.toBe(true);
    await expect(isSessionActive(ctx, claims2.sid!)).resolves.toBe(true);

    await revokeAllMySessions(ctx, userId);

    await expect(isSessionActive(ctx, claims1.sid!)).resolves.toBe(false);
    await expect(isSessionActive(ctx, claims2.sid!)).resolves.toBe(false);
  });

  it("a user cannot revoke another user's session via revokeMySession's ownership scoping", async () => {
    const { ctx: ctxA, sessionToken: tokenA } = await loginAndGetSession();
    const claimsA = await verifySessionToken(tokenA);

    // A second, unrelated user in the SAME tenant.
    await seedSystemRoles(ctxA); // already seeded, idempotent no-op — keeps this test self-contained.
    const userBId = await registerUser(ctxA, { email: "other@example.com", password: "another-strong-pw-1", displayName: "Other", roleName: "Tenant Admin" });

    // userB attempts to revoke userA's session by id — must be rejected outright
    // (SessionNotFoundError, since it isn't among userB's OWN active sessions),
    // never silently succeed against someone else's session.
    await expect(revokeMySession(ctxA, userBId, claimsA.sid!)).rejects.toThrow(SessionNotFoundError);
    await expect(isSessionActive(ctxA, claimsA.sid!)).resolves.toBe(true);
  });

  it("admin: listTenantSessions returns every active session in the tenant, joined with the owning user's email/name", async () => {
    const { ctx, userId, sessionToken } = await loginAndGetSession();
    const claims = await verifySessionToken(sessionToken);
    const rows = await listTenantSessions(ctx);
    const mine = rows.find((r) => r.id === claims.sid);
    expect(mine).toBeDefined();
    expect(mine!.userEmail).toBe("admin@example.com");
    expect(mine!.userId).toBe(userId);
  });

  it("admin: adminRevokeSession revokes ANY session in the tenant (not scoped to a specific caller)", async () => {
    const { ctx, sessionToken } = await loginAndGetSession();
    const claims = await verifySessionToken(sessionToken);
    await adminRevokeSession(ctx, claims.sid!);
    await expect(isSessionActive(ctx, claims.sid!)).resolves.toBe(false);
  });

  it("admin: adminRevokeAllSessionsForUser revokes every active session for the target user", async () => {
    const { ctx, userId, sessionToken: first } = await loginAndGetSession();
    const tenant = await resolveTenantById(ctx.tenantId);
    const second = await login({ tenantSlug: tenant!.slug, email: "admin@example.com", password: "correct-horse-battery-staple" });
    if (second.outcome !== "authenticated") throw new Error("expected authenticated");
    const claims1 = await verifySessionToken(first);
    const claims2 = await verifySessionToken(second.sessionToken);

    await adminRevokeAllSessionsForUser(ctx, userId);

    await expect(isSessionActive(ctx, claims1.sid!)).resolves.toBe(false);
    await expect(isSessionActive(ctx, claims2.sid!)).resolves.toBe(false);
  });

  it("cross-tenant: a session id from tenant A is never active under tenant B's context (RLS-backed isolation)", async () => {
    const { ctx: ctxA, sessionToken: tokenA } = await loginAndGetSession();
    const claimsA = await verifySessionToken(tokenA);

    const ctxB = await createFixtureTenant();
    createdTenantIds.push(ctxB.tenantId);

    await expect(isSessionActive(iamTenantContext(ctxB.tenantId, ctxB.region), claimsA.sid!)).resolves.toBe(false);
    // And, of course, still genuinely active under its own real tenant.
    await expect(isSessionActive(ctxA, claimsA.sid!)).resolves.toBe(true);
  });
});
